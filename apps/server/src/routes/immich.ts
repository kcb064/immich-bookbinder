import { ImmichConnectionInput, type ImmichStatus, SUPPORTED_IMMICH_VERSION } from '@bookbinder/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { z } from 'zod';
import { ImmichApiError, type BinaryResponse, type ImmichClient } from '../immich/client.js';
import { testImmichConnection } from '../immich/status.js';
import { detectTrips, fetchGeoPoints, type TripSuggestion } from '../immich/trips.js';

const IdParams = z.object({ id: z.string().min(1).max(200) });
const ThumbnailQuery = z.object({ size: z.enum(['thumbnail', 'preview']).default('thumbnail') });
const THUMB_CACHE = 'private, max-age=86400';

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const TripsQuery = z.object({ from: IsoDay.optional(), to: IsoDay.optional() });
const PlacesQuery = z.object({ name: z.string().trim().min(1).max(120) });
const SmartQuery = z.object({ q: z.string().trim().min(1).max(500), size: z.coerce.number().int().min(1).max(60).default(24) });

export interface TripsResponse {
  from: string;
  to: string;
  /** Geotagged photos scanned. */
  geotagged: number;
  trips: TripSuggestion[];
}

const TRIPS_CACHE_MS = 10 * 60_000;

export const immichRoutes: FastifyPluginAsync = async (app) => {
  /** Client for the stored connection; replies 409 when Immich is not configured yet. */
  function storedClient(reply: FastifyReply): ImmichClient | undefined {
    const client = app.immichClient();
    if (!client) {
      void reply.code(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Immich is not configured. Save a server URL and API key in Settings first.',
      });
      return undefined;
    }
    return client;
  }

  async function proxyBinary(reply: FastifyReply, load: () => Promise<BinaryResponse>) {
    try {
      const res = await load();
      reply.header('cache-control', THUMB_CACHE).type(res.contentType);
      if (res.contentLength !== undefined) reply.header('content-length', String(res.contentLength));
      if (!res.body) return reply.send(Buffer.alloc(0));
      return reply.send(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>));
    } catch (err) {
      if (err instanceof ImmichApiError) {
        const status = err.status === 404 ? 404 : 502;
        return reply.code(status).send({
          statusCode: status,
          error: status === 404 ? 'Not Found' : 'Bad Gateway',
          message: err.message,
        });
      }
      throw err;
    }
  }

  app.post('/api/immich/test', async (request, reply): Promise<ImmichStatus> => {
    let conn: ImmichConnectionInput | undefined;
    const body = request.body as unknown;
    if (body && typeof body === 'object' && Object.keys(body).length > 0) {
      const parsed = ImmichConnectionInput.safeParse(body);
      if (!parsed.success) {
        return reply.badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      conn = parsed.data;
    } else {
      conn = app.settings.getImmichConnection();
    }
    if (!conn) {
      return {
        connected: false,
        supportedVersion: SUPPORTED_IMMICH_VERSION,
        permissions: [],
        error: 'Immich is not configured. Save a server URL and API key in Settings first.',
      };
    }
    return testImmichConnection(conn);
  });

  app.get('/api/immich/albums', async (_request, reply) => {
    const client = storedClient(reply);
    if (!client) return;
    const albums = await client.getAlbums();
    return albums.map((a) => ({
      id: a.id,
      name: a.albumName,
      description: a.description,
      assetCount: a.assetCount,
      shared: a.shared,
      startDate: a.startDate ?? null,
      endDate: a.endDate ?? null,
      updatedAt: a.updatedAt,
      thumbnailUrl: a.albumThumbnailAssetId
        ? `/api/immich/assets/${encodeURIComponent(a.albumThumbnailAssetId)}/thumbnail?size=thumbnail`
        : null,
    }));
  });

  app.get('/api/immich/people', async (_request, reply) => {
    const client = storedClient(reply);
    if (!client) return;
    const res = await client.getPeople();
    return {
      total: res.total,
      hidden: res.hidden,
      people: res.people.map((p) => ({
        id: p.id,
        name: p.name,
        birthDate: p.birthDate ?? null,
        isFavorite: p.isFavorite ?? false,
        isHidden: p.isHidden,
        thumbnailUrl: `/api/immich/people/${encodeURIComponent(p.id)}/thumbnail`,
      })),
    };
  });

  /** Trip suggestions from geotagged photos in a date range (default: the last two years). Cached per range for ten minutes. */
  const tripsCache = new Map<string, { at: number; value: TripsResponse }>();
  app.get('/api/immich/trips', async (request, reply) => {
    const query = TripsQuery.safeParse(request.query);
    if (!query.success) return reply.badRequest('from and to must be YYYY-MM-DD');
    const client = storedClient(reply);
    if (!client) return;
    const to = query.data.to ? new Date(`${query.data.to}T23:59:59.999Z`) : new Date();
    const from = query.data.from ? new Date(`${query.data.from}T00:00:00.000Z`) : new Date(Date.UTC(to.getUTCFullYear() - 2, to.getUTCMonth(), to.getUTCDate()));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return reply.badRequest('Invalid date range');
    const key = `${client.baseUrl}|${from.toISOString()}|${to.toISOString()}`;
    const cached = tripsCache.get(key);
    if (cached && Date.now() - cached.at < TRIPS_CACHE_MS) return cached.value;
    try {
      const points = await fetchGeoPoints(client, from, to);
      const value: TripsResponse = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), geotagged: points.length, trips: detectTrips(points) };
      tripsCache.set(key, { at: Date.now(), value });
      return value;
    } catch (err) {
      if (err instanceof ImmichApiError) return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: err.message });
      throw err;
    }
  });

  /** Gazetteer lookup; each hit becomes a trip place with a box of about 25 km around it. */
  app.get('/api/immich/places', async (request, reply) => {
    const query = PlacesQuery.safeParse(request.query);
    if (!query.success) return reply.badRequest('name is required');
    const client = storedClient(reply);
    if (!client) return;
    const places = await client.getPlaces(query.data.name);
    return places.slice(0, 12).map((p) => ({
      name: p.name,
      region: p.admin1name ?? null,
      latitude: p.latitude,
      longitude: p.longitude,
    }));
  });

  /** A quick look at what a smart-search query returns, for the wizard. */
  app.get('/api/immich/smart', async (request, reply) => {
    const query = SmartQuery.safeParse(request.query);
    if (!query.success) return reply.badRequest('q is required');
    const client = storedClient(reply);
    if (!client) return;
    const res = await client.searchSmart({ query: query.data.q, size: query.data.size, type: 'IMAGE' });
    return {
      items: res.assets.items.map((a) => ({ id: a.id, fileName: a.originalFileName, thumbnailUrl: `/api/immich/assets/${encodeURIComponent(a.id)}/thumbnail?size=thumbnail` })),
    };
  });

  app.get('/api/immich/people/:id/thumbnail', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid person id');
    const client = storedClient(reply);
    if (!client) return;
    return proxyBinary(reply, () => client.getPersonThumbnail(params.data.id));
  });

  app.get('/api/immich/assets/:id/thumbnail', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const query = ThumbnailQuery.safeParse(request.query);
    if (!params.success) return reply.badRequest('Invalid asset id');
    if (!query.success) return reply.badRequest('size must be thumbnail or preview');
    const client = storedClient(reply);
    if (!client) return;
    return proxyBinary(reply, () => client.getThumbnail(params.data.id, query.data.size));
  });
};

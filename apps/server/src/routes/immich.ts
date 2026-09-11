import { ImmichConnectionInput, type ImmichStatus, SUPPORTED_IMMICH_VERSION } from '@bookbinder/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { z } from 'zod';
import { createImmichClient, ImmichApiError, type BinaryResponse, type ImmichClient } from '../immich/client.js';
import { testImmichConnection } from '../immich/status.js';

const IdParams = z.object({ id: z.string().min(1).max(200) });
const ThumbnailQuery = z.object({ size: z.enum(['thumbnail', 'preview']).default('thumbnail') });
const THUMB_CACHE = 'private, max-age=86400';

export const immichRoutes: FastifyPluginAsync = async (app) => {
  /** Client for the stored connection; replies 409 when Immich is not configured yet. */
  function storedClient(reply: FastifyReply): ImmichClient | undefined {
    const conn = app.settings.getImmichConnection();
    if (!conn) {
      void reply.code(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Immich is not configured. Save a server URL and API key in Settings first.',
      });
      return undefined;
    }
    return createImmichClient(conn);
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

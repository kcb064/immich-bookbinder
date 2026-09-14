import createClient from 'openapi-fetch';
import type { components, paths } from './generated/immich.js';

/*
 * Thin typed wrapper over the generated Immich OpenAPI types (Immich 3.2.0, specs/immich-openapi.json).
 * Keep the surface small: only what the selection engine, editor and connection test need.
 */

export type Schemas = components['schemas'];
export type ImmichServerVersion = Schemas['ServerVersionResponseDto'];
export type ImmichUser = Schemas['UserAdminResponseDto'];
export type ImmichAssetStats = Schemas['AssetStatsResponseDto'];
export type ImmichAlbum = Schemas['AlbumResponseDto'];
export type ImmichAsset = Schemas['AssetResponseDto'];
export type ImmichPerson = Schemas['PersonResponseDto'];
export type ImmichPeoplePage = Schemas['PeopleResponseDto'];
export type ImmichMetadataSearch = Schemas['MetadataSearchDto'];
export type ImmichSmartSearch = Schemas['SmartSearchDto'];
export type ImmichPlace = Schemas['PlacesResponseDto'];
export type ImmichSearchResponse = Schemas['SearchResponseDto'];
export type ImmichMapMarker = Schemas['MapMarkerResponseDto'];
export type ImmichTimeBucket = Schemas['TimeBucketsResponseDto'];
export type ImmichTimeBucketAssets = Schemas['TimeBucketAssetResponseDto'];
export type ImmichAssetFace = Schemas['AssetFaceResponseDto'];
export type ImmichDuplicate = Schemas['DuplicateResponseDto'];
export type ImmichTag = Schemas['TagResponseDto'];
export type ImmichServerAbout = Schemas['ServerAboutResponseDto'];
export type ImmichMediaSize = Schemas['AssetMediaSize'];

type TimelineQuery = NonNullable<paths['/timeline/buckets']['get']['parameters']['query']>;
type MapMarkersQuery = NonNullable<paths['/map/markers']['get']['parameters']['query']>;
type PeopleQuery = NonNullable<paths['/people']['get']['parameters']['query']>;

/** WGS84 bounding box: [west, south, east, north]. */
export type BBox = readonly [number, number, number, number];
export type TimelineParams = Omit<TimelineQuery, 'bbox'> & { bbox?: BBox | string };

export class ImmichApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body?: unknown,
  ) {
    super(`Immich ${path} failed with HTTP ${status}${describeBody(body)}`);
    this.name = 'ImmichApiError';
  }
}

function describeBody(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string') return `: ${m}`;
    if (Array.isArray(m)) return `: ${m.join('; ')}`;
  }
  return '';
}

export interface ImmichClientOptions {
  /** Base URL without /api, e.g. http://immich_server:2283 */
  url: string;
  apiKey: string;
  /** Injectable for tests; defaults to globalThis.fetch looked up at call time. */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in ms (default 30s). */
  timeoutMs?: number;
}

export interface BinaryResponse {
  status: number;
  contentType: string;
  contentLength: number | undefined;
  /** Web ReadableStream of the body; consume or cancel it. */
  body: ReadableStream<Uint8Array> | null;
  /** Buffers the whole body. */
  buffer(): Promise<Buffer>;
}

export type ImmichClient = ReturnType<typeof createImmichClient>;

export function normalizeImmichUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/api$/, '');
}

export function bboxToString(bbox: BBox | string): string {
  return typeof bbox === 'string' ? bbox : bbox.join(',');
}

export function createImmichClient(opts: ImmichClientOptions) {
  const baseUrl = `${normalizeImmichUrl(opts.url)}/api`;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const fetchImpl: typeof globalThis.fetch = (input, init) =>
    (opts.fetch ?? globalThis.fetch)(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });

  const api = createClient<paths>({
    baseUrl,
    headers: { 'x-api-key': opts.apiKey, accept: 'application/json' },
    fetch: (request) => fetchImpl(request),
  });

  function unwrap<T>(
    result: { data?: T; error?: unknown; response: Response },
    path: string,
  ): T {
    if (result.response.ok && result.data !== undefined) return result.data;
    if (result.response.ok) return result.data as T;
    throw new ImmichApiError(result.response.status, path, result.error);
  }

  /** Raw fetch for binary endpoints; JSON parsing is not wanted here. */
  async function binary(path: string, init: RequestInit = {}): Promise<BinaryResponse> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { 'x-api-key': opts.apiKey, ...(init.headers as Record<string, string> | undefined) },
    });
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      throw new ImmichApiError(res.status, path, body);
    }
    const len = res.headers.get('content-length');
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: len ? Number(len) : undefined,
      body: res.body,
      buffer: async () => Buffer.from(await res.arrayBuffer()),
    };
  }

  return {
    baseUrl,

    /** GET /server/version (no auth required). */
    async getServerVersion(): Promise<ImmichServerVersion> {
      return unwrap(await api.GET('/server/version'), '/server/version');
    },

    async getServerAbout(): Promise<ImmichServerAbout> {
      return unwrap(await api.GET('/server/about'), '/server/about');
    },

    async getMyUser(): Promise<ImmichUser> {
      return unwrap(await api.GET('/users/me'), '/users/me');
    },

    async getAssetStatistics(): Promise<ImmichAssetStats> {
      return unwrap(await api.GET('/assets/statistics'), '/assets/statistics');
    },

    async getAlbums(query?: { shared?: boolean }): Promise<ImmichAlbum[]> {
      const params = query?.shared === undefined ? {} : { query: { isShared: query.shared } };
      return unwrap(await api.GET('/albums', { params }), '/albums');
    },

    /** Album with its assets[]. */
    async getAlbum(id: string): Promise<ImmichAlbum> {
      return unwrap(await api.GET('/albums/{id}', { params: { path: { id } } }), `/albums/${id}`);
    },

    async getPeoplePage(query: PeopleQuery = {}): Promise<ImmichPeoplePage> {
      return unwrap(await api.GET('/people', { params: { query } }), '/people');
    },

    /** All (non-hidden) people, following server-side pagination. */
    async getPeople(opts: { withHidden?: boolean } = {}): Promise<ImmichPeoplePage> {
      const size = 1000;
      const all: ImmichPerson[] = [];
      let page = 1;
      let total = 0;
      let hidden = 0;
      for (;;) {
        const res = await this.getPeoplePage({ page, size, withHidden: opts.withHidden ?? false });
        all.push(...res.people);
        total = res.total;
        hidden = res.hidden;
        if (!res.hasNextPage || res.people.length === 0) break;
        page += 1;
      }
      return { people: all, total, hidden, hasNextPage: false };
    },

    /** One page of POST /search/metadata. */
    async searchMetadata(body: ImmichMetadataSearch): Promise<ImmichSearchResponse> {
      return unwrap(await api.POST('/search/metadata', { body }), '/search/metadata');
    },

    /**
     * Iterate every page of a metadata search. Uses `cursor`/`nextCursor` (Immich >= 3.2)
     * and falls back to the deprecated `page` counter for older servers.
     */
    async *searchMetadataPages(
      body: ImmichMetadataSearch,
      opts: { maxPages?: number } = {},
    ): AsyncGenerator<ImmichAsset[], void, undefined> {
      const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
      let cursor: string | undefined;
      let page = body.page ?? 1;
      for (let i = 0; i < maxPages; i++) {
        const req: ImmichMetadataSearch = { ...body };
        if (cursor) req.cursor = cursor;
        else if (i > 0) req.page = page;
        const res = await this.searchMetadata(req);
        const items = res.assets.items;
        if (items.length > 0) yield items;
        const next = res.assets.nextCursor;
        if (next) {
          cursor = next;
          continue;
        }
        if (res.assets.nextPage) {
          const n = Number(res.assets.nextPage);
          page = Number.isFinite(n) ? n : page + 1;
          continue;
        }
        break;
      }
    },

    async searchMetadataAll(body: ImmichMetadataSearch, opts: { maxPages?: number } = {}): Promise<ImmichAsset[]> {
      const out: ImmichAsset[] = [];
      for await (const items of this.searchMetadataPages(body, opts)) out.push(...items);
      return out;
    },

    /** CLIP text (or image) search; Immich returns the `size` best matches, most similar first. */
    async searchSmart(body: ImmichSmartSearch): Promise<ImmichSearchResponse> {
      return unwrap(await api.POST('/search/smart', { body }), '/search/smart');
    },

    /** Gazetteer lookup for the "type a place" picker. */
    async getPlaces(name: string): Promise<ImmichPlace[]> {
      return unwrap(await api.GET('/search/places', { params: { query: { name } } }), '/search/places');
    },

    async getMapMarkers(query: MapMarkersQuery = {}): Promise<ImmichMapMarker[]> {
      return unwrap(await api.GET('/map/markers', { params: { query } }), '/map/markers');
    },

    async getTimeBuckets(params: TimelineParams = {}): Promise<ImmichTimeBucket[]> {
      const { bbox, ...rest } = params;
      const query: TimelineQuery = bbox === undefined ? rest : { ...rest, bbox: bboxToString(bbox) };
      return unwrap(await api.GET('/timeline/buckets', { params: { query } }), '/timeline/buckets');
    },

    /** Columnar asset arrays for one bucket (id[], latitude[], fileCreatedAt[], ...). */
    async getTimeBucket(timeBucket: string, params: TimelineParams = {}): Promise<ImmichTimeBucketAssets> {
      const { bbox, ...rest } = params;
      const query = bbox === undefined ? { ...rest, timeBucket } : { ...rest, timeBucket, bbox: bboxToString(bbox) };
      return unwrap(await api.GET('/timeline/bucket', { params: { query } }), '/timeline/bucket');
    },

    async getFaces(assetId: string): Promise<ImmichAssetFace[]> {
      return unwrap(await api.GET('/faces', { params: { query: { id: assetId } } }), '/faces');
    },

    async getDuplicates(): Promise<ImmichDuplicate[]> {
      return unwrap(await api.GET('/duplicates'), '/duplicates');
    },

    async getTags(): Promise<ImmichTag[]> {
      return unwrap(await api.GET('/tags'), '/tags');
    },

    getThumbnail(assetId: string, size: ImmichMediaSize = 'thumbnail'): Promise<BinaryResponse> {
      return binary(`/assets/${encodeURIComponent(assetId)}/thumbnail?size=${size}`);
    },

    /** The original file, streamed. Callers cache it on disk; never hold many in memory. */
    getOriginal(assetId: string): Promise<BinaryResponse> {
      return binary(`/assets/${encodeURIComponent(assetId)}/original`);
    },

    /** First byte of the original file; proves asset.download without transferring the file. */
    async probeOriginal(assetId: string): Promise<BinaryResponse> {
      const res = await binary(`/assets/${encodeURIComponent(assetId)}/original`, {
        headers: { range: 'bytes=0-0' },
      });
      await res.body?.cancel().catch(() => undefined);
      return res;
    },

    getPersonThumbnail(personId: string): Promise<BinaryResponse> {
      return binary(`/people/${encodeURIComponent(personId)}/thumbnail`);
    },
  };
}

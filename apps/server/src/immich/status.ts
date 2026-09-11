import {
  REQUIRED_IMMICH_PERMISSIONS,
  SUPPORTED_IMMICH_VERSION,
  type ImmichConnectionInput,
  type ImmichStatus,
  type PermissionProbe,
  type RequiredImmichPermission,
} from '@bookbinder/shared';
import { createImmichClient, ImmichApiError, type ImmichClient } from './client.js';

export interface TestConnectionDeps {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function describeError(err: unknown): string {
  if (err instanceof ImmichApiError) return `HTTP ${err.status}`;
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? ` (${cause.message})` : '';
    return `${err.message}${causeMsg}`;
  }
  return String(err);
}

function formatVersion(v: { major: number; minor: number; patch: number }): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function versionWarning(server: string, supported: string): string | undefined {
  const [sMaj, sMin] = server.split('.').map(Number);
  const [pMaj, pMin] = supported.split('.').map(Number);
  if (sMaj === pMaj && sMin === pMin) return undefined;
  return `Immich ${server} differs from the version this app was built against (${supported}); some features may not work.`;
}

/** Cheap call per permission; a 403 from Immich means the API key lacks it. */
type Probe = (client: ImmichClient, ctx: { sampleAssetId: string | undefined }) => Promise<string | undefined>;

const probes: Record<RequiredImmichPermission, Probe> = {
  'server.about': async (c) => {
    await c.getServerAbout();
    return undefined;
  },
  'user.read': async (c) => {
    await c.getMyUser();
    return undefined;
  },
  'asset.read': async (c) => {
    await c.searchMetadata({ size: 1 });
    return undefined;
  },
  'asset.view': async (c, { sampleAssetId }) => {
    if (!sampleAssetId) return 'not probed (no assets)';
    const res = await c.getThumbnail(sampleAssetId, 'thumbnail');
    await res.body?.cancel().catch(() => undefined);
    return undefined;
  },
  'asset.download': async (c, { sampleAssetId }) => {
    if (!sampleAssetId) return 'not probed (no assets)';
    await c.probeOriginal(sampleAssetId);
    return undefined;
  },
  'asset.statistics': async (c) => {
    await c.getAssetStatistics();
    return undefined;
  },
  'album.read': async (c) => {
    await c.getAlbums();
    return undefined;
  },
  'person.read': async (c) => {
    await c.getPeoplePage({ size: 1 });
    return undefined;
  },
  'face.read': async (c, { sampleAssetId }) => {
    if (!sampleAssetId) return 'not probed (no assets)';
    await c.getFaces(sampleAssetId);
    return undefined;
  },
  'duplicate.read': async (c) => {
    await c.getDuplicates();
    return undefined;
  },
  'tag.read': async (c) => {
    await c.getTags();
    return undefined;
  },
  'timeline.read': async (c) => {
    await c.getTimeBuckets();
    return undefined;
  },
  'map.read': async (c) => {
    // Narrow range keeps the response tiny; only the permission check matters.
    const before = new Date();
    const after = new Date(before.getTime() - 24 * 60 * 60 * 1000);
    await c.getMapMarkers({ fileCreatedAfter: after.toISOString(), fileCreatedBefore: before.toISOString() });
    return undefined;
  },
};

async function runProbe(
  permission: RequiredImmichPermission,
  client: ImmichClient,
  ctx: { sampleAssetId: string | undefined },
): Promise<PermissionProbe> {
  try {
    const detail = await probes[permission](client, ctx);
    return detail === undefined ? { permission, ok: true } : { permission, ok: true, detail };
  } catch (err) {
    if (err instanceof ImmichApiError) {
      if (err.status === 403) return { permission, ok: false, detail: 'missing (HTTP 403)' };
      if (err.status === 401) return { permission, ok: false, detail: 'unauthorized (HTTP 401)' };
      return { permission, ok: false, detail: `probe failed: ${err.message}` };
    }
    return { permission, ok: false, detail: `probe failed: ${describeError(err)}` };
  }
}

/** Runs the full connection test used by POST /api/immich/test. Never throws. */
export async function testImmichConnection(
  conn: ImmichConnectionInput,
  deps: TestConnectionDeps = {},
): Promise<ImmichStatus> {
  const client = createImmichClient({
    url: conn.url,
    apiKey: conn.apiKey,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    timeoutMs: deps.timeoutMs ?? 15_000,
  });
  const status: ImmichStatus = {
    connected: false,
    url: conn.url,
    supportedVersion: SUPPORTED_IMMICH_VERSION,
    permissions: [],
  };

  try {
    status.serverVersion = formatVersion(await client.getServerVersion());
  } catch (err) {
    status.error = `Could not reach Immich at ${conn.url}: ${describeError(err)}`;
    return status;
  }

  try {
    const me = await client.getMyUser();
    status.user = { id: me.id, name: me.name, email: me.email };
  } catch (err) {
    status.error =
      err instanceof ImmichApiError && err.status === 401
        ? 'Immich rejected the API key (HTTP 401)'
        : `Could not read the API key user (${describeError(err)})`;
    return status;
  }
  status.connected = true;

  const [stats, people, albums, sample] = await Promise.allSettled([
    client.getAssetStatistics(),
    client.getPeoplePage({ size: 1 }),
    client.getAlbums(),
    client.searchMetadata({ size: 1 }),
  ]);
  if (stats.status === 'fulfilled') status.photos = stats.value.images;
  if (people.status === 'fulfilled') status.people = people.value.total;
  if (albums.status === 'fulfilled') status.albums = albums.value.length;
  const sampleAssetId = sample.status === 'fulfilled' ? sample.value.assets.items[0]?.id : undefined;

  status.permissions = await Promise.all(
    REQUIRED_IMMICH_PERMISSIONS.map((p) => runProbe(p, client, { sampleAssetId })),
  );

  const warnings: string[] = [];
  const missing = status.permissions.filter((p) => !p.ok).map((p) => p.permission);
  if (missing.length > 0) warnings.push(`API key is missing permissions: ${missing.join(', ')}`);
  const vw = status.serverVersion ? versionWarning(status.serverVersion, SUPPORTED_IMMICH_VERSION) : undefined;
  if (vw) warnings.push(vw);
  if (warnings.length > 0) status.error = warnings.join(' ');

  return status;
}

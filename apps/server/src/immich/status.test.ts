import { REQUIRED_IMMICH_PERMISSIONS, SUPPORTED_IMMICH_VERSION } from '@bookbinder/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, loginCookie } from '../test/helpers.js';
import { testImmichConnection } from './status.js';

type Handler = (url: URL, method: string, headers: Headers) => Response | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const forbidden = (permission: string) => json({ message: `Not found or no ${permission} permission`, statusCode: 403 }, 403);

/** Minimal fake Immich 3.2.0 on top of fetch; `overrides` win over the defaults. */
function fakeImmich(overrides: Handler = () => undefined) {
  const calls: { method: string; path: string; apiKey: string | null }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '');
    calls.push({ method: req.method, path, apiKey: req.headers.get('x-api-key') });
    const custom = overrides(url, req.method, req.headers);
    if (custom) return custom;
    switch (path) {
      case '/server/version':
        return json({ major: 3, minor: 2, patch: 0, prerelease: null });
      case '/server/about':
        return json({ version: 'v3.2.0', versionUrl: 'https://example.com', licensed: false });
      case '/users/me':
        return json({ id: 'u1', name: 'Kevin', email: 'kevin@example.com' });
      case '/assets/statistics':
        return json({ images: 1234, videos: 56, total: 1290 });
      case '/people':
        return json({ people: [{ id: 'p1', name: 'Grandma' }], total: 17, hidden: 2, hasNextPage: false });
      case '/albums':
        return json([{ id: 'a1', albumName: 'Trip' }, { id: 'a2', albumName: 'Kids' }]);
      case '/search/metadata':
        return json({ albums: { total: 0, count: 0, items: [], facets: [] }, assets: { total: 1, count: 1, items: [{ id: 'asset-1' }], facets: [], nextCursor: null, nextPage: null } });
      case '/assets/asset-1/thumbnail':
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      case '/assets/asset-1/original':
        return new Response(new Uint8Array([0xff]), { status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/100' } });
      case '/faces':
        return json([]);
      case '/duplicates':
        return json([]);
      case '/tags':
        return json([]);
      case '/timeline/buckets':
        return json([{ timeBucket: '2026-05-01', count: 3 }]);
      case '/map/markers':
        return json([]);
      default:
        return json({ message: `unhandled ${path}`, statusCode: 404 }, 404);
    }
  });
  return { fetchMock, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('testImmichConnection', () => {
  it('reports server info, counts and a 403 as a missing permission', async () => {
    const { fetchMock, calls } = fakeImmich((url) => (url.pathname.endsWith('/duplicates') ? forbidden('duplicate.read') : undefined));
    vi.stubGlobal('fetch', fetchMock);

    const status = await testImmichConnection({ url: 'http://immich_server:2283/', apiKey: 'test-api-key-1234' });

    expect(status.connected).toBe(true);
    expect(status.serverVersion).toBe('3.2.0');
    expect(status.supportedVersion).toBe(SUPPORTED_IMMICH_VERSION);
    expect(status.user).toEqual({ id: 'u1', name: 'Kevin', email: 'kevin@example.com' });
    expect(status.photos).toBe(1234);
    expect(status.people).toBe(17);
    expect(status.albums).toBe(2);

    expect(status.permissions.map((p) => p.permission)).toEqual([...REQUIRED_IMMICH_PERMISSIONS]);
    const byName = Object.fromEntries(status.permissions.map((p) => [p.permission, p]));
    expect(byName['duplicate.read']).toEqual({ permission: 'duplicate.read', ok: false, detail: 'missing (HTTP 403)' });
    for (const p of REQUIRED_IMMICH_PERMISSIONS.filter((n) => n !== 'duplicate.read')) {
      expect(byName[p]?.ok, p).toBe(true);
    }
    expect(status.error).toMatch(/missing permissions: duplicate\.read/);
    expect(status.error).not.toMatch(/differs/);

    // Every authenticated call carried the API key against the normalized /api base URL.
    expect(calls.every((c) => c.apiKey === 'test-api-key-1234')).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(10);
    const first = fetchMock.mock.calls[0]?.[0];
    const firstUrl = first instanceof Request ? first.url : String(first);
    expect(firstUrl).toBe('http://immich_server:2283/api/server/version');
    // The download probe asked for a single byte.
    const original = calls.find((c) => c.path === '/assets/asset-1/original');
    expect(original).toBeDefined();
  });

  it('adds a non-fatal version mismatch warning', async () => {
    const { fetchMock } = fakeImmich((url) =>
      url.pathname.endsWith('/server/version') ? json({ major: 3, minor: 4, patch: 1, prerelease: null }) : undefined,
    );
    vi.stubGlobal('fetch', fetchMock);
    const status = await testImmichConnection({ url: 'http://immich_server:2283', apiKey: 'test-api-key-1234' });
    expect(status.connected).toBe(true);
    expect(status.serverVersion).toBe('3.4.1');
    expect(status.error).toMatch(/3\.4\.1 differs from .*3\.2\.0/);
  });

  it('reports a rejected API key without probing further', async () => {
    const { fetchMock, calls } = fakeImmich((url) => (url.pathname.endsWith('/users/me') ? json({ message: 'Unauthorized' }, 401) : undefined));
    vi.stubGlobal('fetch', fetchMock);
    const status = await testImmichConnection({ url: 'http://immich_server:2283', apiKey: 'wrong-key-123456' });
    expect(status.connected).toBe(false);
    expect(status.serverVersion).toBe('3.2.0');
    expect(status.error).toMatch(/rejected the API key/);
    expect(status.permissions).toEqual([]);
    expect(calls.map((c) => c.path)).toEqual(['/server/version', '/users/me']);
  });

  it('reports an unreachable server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const status = await testImmichConnection({ url: 'http://nowhere:2283', apiKey: 'test-api-key-1234' });
    expect(status.connected).toBe(false);
    expect(status.error).toMatch(/Could not reach Immich at http:\/\/nowhere:2283/);
  });

  it('skips asset-dependent probes gracefully when the library is empty', async () => {
    const { fetchMock } = fakeImmich((url) =>
      url.pathname.endsWith('/search/metadata')
        ? json({ albums: { total: 0, count: 0, items: [], facets: [] }, assets: { total: 0, count: 0, items: [], facets: [], nextCursor: null } })
        : undefined,
    );
    vi.stubGlobal('fetch', fetchMock);
    const status = await testImmichConnection({ url: 'http://immich_server:2283', apiKey: 'test-api-key-1234' });
    const byName = Object.fromEntries(status.permissions.map((p) => [p.permission, p]));
    expect(byName['asset.view']).toEqual({ permission: 'asset.view', ok: true, detail: 'not probed (no assets)' });
    expect(byName['asset.download']?.detail).toBe('not probed (no assets)');
    expect(byName['face.read']?.detail).toBe('not probed (no assets)');
    expect(status.error).toBeUndefined();
  });
});

describe('Immich routes', () => {
  it('POST /api/immich/test uses the body or the stored settings and never leaks the key', async () => {
    const t = await createTestApp();
    try {
      const cookie = await loginCookie(t.app);
      const { fetchMock, calls } = fakeImmich();
      vi.stubGlobal('fetch', fetchMock);

      const unconfigured = await t.app.inject({ method: 'POST', url: '/api/immich/test', headers: { cookie } });
      expect(unconfigured.statusCode).toBe(200);
      expect(unconfigured.json()).toMatchObject({ connected: false, error: expect.stringMatching(/not configured/) });

      const withBody = await t.app.inject({
        method: 'POST',
        url: '/api/immich/test',
        headers: { cookie },
        payload: { url: 'http://immich_server:2283', apiKey: 'body-key-0123456789' },
      });
      expect(withBody.statusCode).toBe(200);
      expect(withBody.json()).toMatchObject({ connected: true, serverVersion: '3.2.0' });
      expect(withBody.body).not.toContain('body-key');
      expect(calls.at(-1)?.apiKey).toBe('body-key-0123456789');

      await t.app.inject({
        method: 'PUT',
        url: '/api/settings/immich',
        headers: { cookie },
        payload: { url: 'http://immich_server:2283', apiKey: 'stored-key-0123456789' },
      });
      calls.length = 0;
      const stored = await t.app.inject({ method: 'POST', url: '/api/immich/test', headers: { cookie } });
      expect(stored.json().connected).toBe(true);
      expect(calls.every((c) => c.apiKey === 'stored-key-0123456789')).toBe(true);

      const albums = await t.app.inject({ method: 'GET', url: '/api/immich/albums', headers: { cookie } });
      expect(albums.statusCode).toBe(200);
      expect(albums.json()).toHaveLength(2);
      expect(albums.json()[0]).toMatchObject({ id: 'a1', name: 'Trip' });

      const people = await t.app.inject({ method: 'GET', url: '/api/immich/people', headers: { cookie } });
      expect(people.json().people[0]).toMatchObject({ id: 'p1', name: 'Grandma', thumbnailUrl: '/api/immich/people/p1/thumbnail' });

      const thumb = await t.app.inject({
        method: 'GET',
        url: '/api/immich/assets/asset-1/thumbnail?size=preview',
        headers: { cookie },
      });
      expect(thumb.statusCode).toBe(200);
      expect(thumb.headers['content-type']).toBe('image/jpeg');
      expect(thumb.headers['cache-control']).toBe('private, max-age=86400');
      expect(thumb.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(calls.at(-1)?.path).toBe('/assets/asset-1/thumbnail');

      const badSize = await t.app.inject({ method: 'GET', url: '/api/immich/assets/asset-1/thumbnail?size=original', headers: { cookie } });
      expect(badSize.statusCode).toBe(400);

      const missing = await t.app.inject({ method: 'GET', url: '/api/immich/assets/nope/thumbnail', headers: { cookie } });
      expect(missing.statusCode).toBe(404);
    } finally {
      await t.cleanup();
    }
  });

  it('answers 409 when Immich is not configured', async () => {
    const t = await createTestApp();
    try {
      const cookie = await loginCookie(t.app);
      const res = await t.app.inject({ method: 'GET', url: '/api/immich/albums', headers: { cookie } });
      expect(res.statusCode).toBe(409);
    } finally {
      await t.cleanup();
    }
  });
});

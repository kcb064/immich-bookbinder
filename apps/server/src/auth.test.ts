import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, loginCookie, TEST_PASSWORD, type TestApp } from './test/helpers.js';

describe('auth flow', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it('GET /api/health is public', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', version: expect.any(String), uptimeSeconds: expect.any(Number) });
  });

  it('rejects a wrong password with 401 and sets no cookie', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.cookies).toHaveLength(0);
  });

  it('rejects a malformed body with 400', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { nope: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it('accepts the right password and sets a signed httpOnly cookie', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: TEST_PASSWORD } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true, via: 'session' });
    const cookie = res.cookies.find((c) => c.name === 'bb_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
    // Plain HTTP request: the cookie must not be Secure, or browsers on http://nas:3080 drop it.
    expect(cookie?.secure).toBeFalsy();
    // Signed cookies carry a `.signature` suffix.
    expect(cookie?.value).toContain('.');
  });

  it('marks the cookie Secure when the request was forwarded over HTTPS (tunnel)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
      headers: { 'x-forwarded-proto': 'https' },
      remoteAddress: '10.8.8.8',
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === 'bb_session')?.secure).toBe(true);
  });

  it('protects /api/settings without a cookie and allows it with one', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/api/settings' });
    expect(anon.statusCode).toBe(401);

    const cookie = await loginCookie(t.app);
    const ok = await t.app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      immich: { apiKeySet: false },
      lulu: { sandbox: true, clientKeySet: false },
      ai: { enabled: false, apiKeySet: false },
    });
  });

  it('rejects a forged cookie', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: 'bb_session=forged-session-id.badsignature' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('reports /api/auth/me and logs out', async () => {
    const cookie = await loginCookie(t.app);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toEqual({ authenticated: true, via: 'session' });

    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    const cleared = out.cookies.find((c) => c.name === 'bb_session');
    expect(cleared?.value).toBe('');

    const after = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.json()).toEqual({ authenticated: false, via: null });
    const anonMe = await t.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anonMe.statusCode).toBe(200);
  });

  it('stores and hides the Immich API key in settings', async () => {
    const cookie = await loginCookie(t.app);
    const put = await t.app.inject({
      method: 'PUT',
      url: '/api/settings/immich',
      headers: { cookie },
      payload: { url: 'http://immich_server:2283/', apiKey: 'super-secret-immich-key' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().immich).toEqual({ url: 'http://immich_server:2283', apiKeySet: true });
    expect(JSON.stringify(put.json())).not.toContain('super-secret');

    // Encrypted at rest, decryptable through the store.
    const rows = t.app.db.select().from(t.app.db._.fullSchema.settings).all();
    const keyRow = rows.find((r) => r.key === 'immich.apiKey');
    expect(keyRow?.encrypted).toBe(true);
    expect(keyRow?.value).not.toContain('super-secret');
    expect(t.app.settings.getImmichConnection()).toEqual({
      url: 'http://immich_server:2283',
      apiKey: 'super-secret-immich-key',
    });

    const bad = await t.app.inject({
      method: 'PUT',
      url: '/api/settings/immich',
      headers: { cookie },
      payload: { url: 'not-a-url', apiKey: 'x' },
    });
    expect(bad.statusCode).toBe(400);

    const del = await t.app.inject({ method: 'DELETE', url: '/api/settings/immich', headers: { cookie } });
    expect(del.json().immich).toEqual({ apiKeySet: false });

    const pub = await t.app.inject({
      method: 'PUT',
      url: '/api/settings/public-url',
      headers: { cookie },
      payload: { publicUrl: 'https://books.example.com/' },
    });
    expect(pub.json().publicUrl).toBe('https://books.example.com');
  });

  it('rate-limits login to 5 per minute per IP', async () => {
    const results: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong' },
        remoteAddress: '10.9.9.9',
      });
      results.push(res.statusCode);
    }
    expect(results.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(results[5]).toBe(429);
    expect(results[6]).toBe(429);
  });

  it('leaves /s/* and /public/* unauthenticated (404 placeholders)', async () => {
    const s = await t.app.inject({ method: 'GET', url: '/s/some-token/index.json' });
    expect(s.statusCode).toBe(404);
    expect(s.json().message).toMatch(/not available yet/);
    const p = await t.app.inject({ method: 'GET', url: '/public/x.jpg' });
    expect(p.statusCode).toBe(404);
  });
});

describe('auth variants', () => {
  it('verifies ADMIN_PASSWORD_HASH with argon2', async () => {
    const hash = await argon2.hash('hashed-pw', { type: argon2.argon2id });
    const t = await createTestApp({ ADMIN_PASSWORD: undefined, ADMIN_PASSWORD_HASH: hash });
    try {
      const bad = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'hashed-pw!' } });
      expect(bad.statusCode).toBe(401);
      const good = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'hashed-pw' } });
      expect(good.statusCode).toBe(200);
    } finally {
      await t.cleanup();
    }
  });

  it('trusts the Cloudflare Access header only when TRUST_CF_ACCESS=true', async () => {
    const off = await createTestApp();
    try {
      const res = await off.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { 'cf-access-authenticated-user-email': 'admin@example.com' },
      });
      expect(res.json()).toEqual({ authenticated: false, via: null });
    } finally {
      await off.cleanup();
    }

    const on = await createTestApp({ TRUST_CF_ACCESS: 'true' });
    try {
      const res = await on.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { 'cf-access-authenticated-user-email': 'admin@example.com' },
      });
      expect(res.statusCode).toBe(200);
      const me = await on.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { 'cf-access-authenticated-user-email': 'admin@example.com' },
      });
      expect(me.json()).toEqual({ authenticated: true, via: 'cf-access' });
    } finally {
      await on.cleanup();
    }
  });
});

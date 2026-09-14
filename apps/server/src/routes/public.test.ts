import { Book, RenderJob, ShareView, ViewerBook } from '@bookbinder/shared';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromiumAvailable } from '../render/renderer.js';
import { createTestApp, loginCookie, type TestApp } from '../test/helpers.js';
import { startFakeImmich, type FakeImmich } from '../test/fake-immich.js';

const hasChromium = await chromiumAvailable();

/** Token part of a share URL. */
const tokenOf = (share: ShareView): string => share.url.split('/s/')[1]!;

describe('shares and the public viewer', () => {
  let t: TestApp;
  let cookie: string;
  let immich: FakeImmich;
  let bookId: string;
  let ip = 0;
  /** A fresh client IP per call so the per-IP limits only trip when a test wants them to. */
  const client = () => `10.9.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;

  beforeAll(async () => {
    immich = await startFakeImmich({ photos: 14, originalLongEdge: 1200 });
    t = await createTestApp({}, { render: { batchSize: 6, webFonts: false } });
    cookie = await loginCookie(t.app);
    await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: immich.url, apiKey: 'test-api-key-1234' } });
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Douro weekend', formatId: 'lulu-square-8.5', themeId: 'warm-editorial', rules: { sources: [{ kind: 'album', albumIds: ['album-trip'] }], targetPages: 24 } },
    });
    bookId = Book.parse(created.json()).id;
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await immich.close();
  });

  it('refuses to share a book that has no pages', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/shares`, headers: { cookie }, payload: { allowDownload: true } });
    expect(res.statusCode).toBe(409);
    const laid = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: {} });
    expect(laid.statusCode).toBe(200);
  });

  it('builds share links from the public URL, falling back to the request origin with a warning', async () => {
    const fallback = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/shares`, headers: { cookie, host: 'nas.local:3080' }, payload: { allowDownload: false } });
    expect(fallback.statusCode, fallback.body).toBe(201);
    const s1 = ShareView.parse(fallback.json());
    expect(s1.url).toMatch(/^http:\/\/nas\.local:3080\/s\/[A-Za-z0-9_-]{43}$/);
    expect(s1.warning).toMatch(/No public URL/);
    expect(s1.status).toBe('active');
    expect(s1.hasPassword).toBe(false);

    await t.app.inject({ method: 'PUT', url: '/api/settings/public-url', headers: { cookie }, payload: { publicUrl: 'https://books.example.com/' } });
    const list = z.array(ShareView).parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/shares`, headers: { cookie } })).json());
    expect(list).toHaveLength(1);
    expect(list[0]!.url).toBe(`https://books.example.com/s/${tokenOf(s1)}`);
    expect(list[0]!.warning).toBeUndefined();
  });

  it('serves book.json without asset ids or Immich data, and counts views', async () => {
    const share = ShareView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/shares`, headers: { cookie }, payload: { allowDownload: true } })).json());
    const token = tokenOf(share);
    const res = await t.app.inject({ method: 'GET', url: `/s/${token}/book.json`, remoteAddress: client() });
    expect(res.statusCode, res.body).toBe(200);
    const vb = ViewerBook.parse(res.json());
    expect(vb.title).toBe('Douro weekend');
    expect(vb.dates).toMatch(/2026/);
    expect(vb.format).toEqual({ trimWidthIn: 8.5, trimHeightIn: 8.5, bleedIn: 0.125 });
    // Nothing from Immich leaks: no asset ids, no fake-Immich URL, no file names.
    const body = res.body;
    for (const a of immich.assets) {
      expect(body).not.toContain(a.id);
      expect(body).not.toContain(a.fileName);
    }
    expect(body).not.toContain(immich.url);
    expect(Object.keys(vb).sort()).toEqual(['chapters', 'cover', 'dates', 'download', 'format', 'pageCount', 'title', 'version'].filter((k) => k !== 'dates' || vb.dates !== undefined).sort());
    expect(vb.coverFront).toBeUndefined();

    const after = z.array(ShareView).parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/shares`, headers: { cookie } })).json());
    expect(after.find((s) => s.id === share.id)?.views).toBe(1);
    expect(after.find((s) => s.id === share.id)?.lastViewedAt).toBeTruthy();

    // No preview render yet: no pages, and the pages route says so.
    expect(vb.pageCount).toBe(0);
    expect((await t.app.inject({ method: 'GET', url: `/s/${token}/pages/0.png`, remoteAddress: client() })).statusCode).toBe(404);
    // Download is allowed but nothing is rendered: 404, not 403.
    expect((await t.app.inject({ method: 'GET', url: `/s/${token}/pdf`, remoteAddress: client() })).statusCode).toBe(404);
  });

  it('answers 404 for unknown tokens and never leaks whether a token exists through the SPA route', async () => {
    expect((await t.app.inject({ method: 'GET', url: `/s/${'x'.repeat(43)}/book.json`, remoteAddress: client() })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/s/short/book.json', remoteAddress: client() })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/s/${'x'.repeat(43)}`, remoteAddress: client() })).statusCode).toBe(404);
  });

  it('gates a password-protected share with an unlock cookie', async () => {
    const share = ShareView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/shares`, headers: { cookie }, payload: { password: 'porto2026', allowDownload: false } })).json());
    expect(share.hasPassword).toBe(true);
    const token = tokenOf(share);
    const locked = await t.app.inject({ method: 'GET', url: `/s/${token}/book.json`, remoteAddress: client() });
    expect(locked.statusCode).toBe(401);
    expect(locked.json()).toMatchObject({ needsPassword: true });
    // The SPA shell is not password-gated (it shows the form); without WEB_DIST in tests it is a 404, not a 401.
    const shell = await t.app.inject({ method: 'GET', url: `/s/${token}`, remoteAddress: client() });
    expect(shell.statusCode).toBe(404);
    expect(shell.json().message).toMatch(/not built/);

    const wrong = await t.app.inject({ method: 'POST', url: `/s/${token}/unlock`, payload: { password: 'nope' }, remoteAddress: client() });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.cookies).toHaveLength(0);

    const ok = await t.app.inject({ method: 'POST', url: `/s/${token}/unlock`, payload: { password: 'porto2026' }, remoteAddress: client() });
    expect(ok.statusCode).toBe(200);
    const c = ok.cookies.find((x) => x.name === `bb_share_${token}`);
    expect(c).toBeDefined();
    expect(c!.path).toBe(`/s/${token}`);
    expect(c!.httpOnly).toBe(true);
    const unlocked = await t.app.inject({ method: 'GET', url: `/s/${token}/book.json`, headers: { cookie: `${c!.name}=${c!.value}` }, remoteAddress: client() });
    expect(unlocked.statusCode).toBe(200);

    // A tampered cookie does not unlock; changing the password invalidates the old cookie.
    const forged = await t.app.inject({ method: 'GET', url: `/s/${token}/book.json`, headers: { cookie: `${c!.name}=${c!.value.slice(0, -4)}AAAA` }, remoteAddress: client() });
    expect(forged.statusCode).toBe(401);
    const updated = await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}/shares/${share.id}`, headers: { cookie }, payload: { password: 'lisboa2026' } });
    expect(updated.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: `/s/${token}/book.json`, headers: { cookie: `${c!.name}=${c!.value}` }, remoteAddress: client() })).statusCode).toBe(401);
    // Removing the password opens the link.
    await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}/shares/${share.id}`, headers: { cookie }, payload: { password: null } });
    expect((await t.app.inject({ method: 'GET', url: `/s/${token}/book.json`, remoteAddress: client() })).statusCode).toBe(200);
  });

  it('answers 410 for expired and revoked links', async () => {
    const expired = await t.app.shares.create(bookId, { expiresInDays: 1, allowDownload: false }, Date.now() - 2 * 24 * 60 * 60 * 1000);
    const e = await t.app.inject({ method: 'GET', url: `/s/${expired.token}/book.json`, remoteAddress: client() });
    expect(e.statusCode).toBe(410);
    expect(e.json()).toMatchObject({ reason: 'expired' });
    const list = z.array(ShareView).parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/shares`, headers: { cookie } })).json());
    expect(list.find((s) => s.id === expired.id)?.status).toBe('expired');

    const share = ShareView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/shares`, headers: { cookie }, payload: { allowDownload: true, expiresInDays: 30 } })).json());
    expect(share.expiresAt).toBeTruthy();
    const revoked = await t.app.inject({ method: 'DELETE', url: `/api/books/${bookId}/shares/${share.id}`, headers: { cookie } });
    expect(revoked.statusCode).toBe(200);
    expect(ShareView.parse(revoked.json()).status).toBe('revoked');
    const r = await t.app.inject({ method: 'GET', url: `/s/${tokenOf(share)}/book.json`, remoteAddress: client() });
    expect(r.statusCode).toBe(410);
    expect(r.json()).toMatchObject({ reason: 'revoked' });
    expect((await t.app.inject({ method: 'POST', url: `/s/${tokenOf(share)}/unlock`, payload: { password: 'x' }, remoteAddress: client() })).statusCode).toBe(410);
  });

  it('rate-limits the public routes per IP', async () => {
    const share = ShareView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/shares`, headers: { cookie }, payload: { allowDownload: false } })).json());
    const addr = client();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await t.app.inject({ method: 'GET', url: `/s/${tokenOf(share)}/book.json`, remoteAddress: addr })).statusCode;
    expect(last).toBe(429);
    // Another client is unaffected.
    expect((await t.app.inject({ method: 'GET', url: `/s/${tokenOf(share)}/book.json`, remoteAddress: client() })).statusCode).toBe(200);
  });

  it.skipIf(!hasChromium)('serves page PNGs, the cover and the PDF once rendered, honouring the download flag', async () => {
    for (const kind of ['preview', 'print'] as const) {
      const q = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind } });
      expect(q.statusCode, q.body).toBe(202);
    }
    await t.app.renders.idle();
    const renders = z.array(RenderJob).parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders`, headers: { cookie } })).json());
    expect(renders.every((r) => r.status === 'done')).toBe(true);
    const preview = renders.find((r) => r.kind === 'preview')!;

    const open = ShareView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/shares`, headers: { cookie }, payload: { allowDownload: true } })).json());
    const token = tokenOf(open);
    const vb = ViewerBook.parse((await t.app.inject({ method: 'GET', url: `/s/${token}/book.json`, remoteAddress: client() })).json());
    expect(vb.pageCount).toBe(24);
    expect(vb.cover).toBe(true);
    expect(vb.coverFront?.x).toBeGreaterThan(0.5);
    expect(vb.coverFront!.x + vb.coverFront!.w).toBeLessThan(1);
    expect(vb.download).toBe(true);
    expect(vb.version).toBe(preview.id);

    const page = await t.app.inject({ method: 'GET', url: `/s/${token}/pages/0.png?v=${vb.version}`, remoteAddress: client() });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toBe('image/png');
    expect(page.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    expect((await t.app.inject({ method: 'GET', url: `/s/${token}/pages/23.png`, remoteAddress: client() })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: `/s/${token}/pages/24.png`, remoteAddress: client() })).statusCode).toBe(404);
    const cover = await t.app.inject({ method: 'GET', url: `/s/${token}/cover.png`, remoteAddress: client() });
    expect(cover.statusCode).toBe(200);
    const pdf = await t.app.inject({ method: 'GET', url: `/s/${token}/pdf`, remoteAddress: client() });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe('attachment; filename="douro-weekend.pdf"');

    const noDownload = ShareView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/shares`, headers: { cookie }, payload: { allowDownload: false } })).json());
    const vb2 = ViewerBook.parse((await t.app.inject({ method: 'GET', url: `/s/${tokenOf(noDownload)}/book.json`, remoteAddress: client() })).json());
    expect(vb2.download).toBe(false);
    expect((await t.app.inject({ method: 'GET', url: `/s/${tokenOf(noDownload)}/pdf`, remoteAddress: client() })).statusCode).toBe(403);
    // Pages stay readable without the download flag.
    expect((await t.app.inject({ method: 'GET', url: `/s/${tokenOf(noDownload)}/pages/1.png`, remoteAddress: client() })).statusCode).toBe(200);
  }, 240_000);
});

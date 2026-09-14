import { Book, FORMAT_PRESETS, LuluStatus, OrderView, ReachabilityReport, RenderJob, SettingsView, type ShippingAddress } from '@bookbinder/shared';
import { coverGeometry } from '@bookbinder/layout';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renders } from '../db/schema.js';
import { chromiumAvailable } from '../render/renderer.js';
import { SPINE_ESTIMATED_WARNING } from '../render/service.js';
import { createTestApp, loginCookie, type TestApp } from '../test/helpers.js';
import { startFakeImmich, type FakeImmich } from '../test/fake-immich.js';
import { fakeCoverDimensionsIn, startFakeLulu, type FakeLulu } from '../test/fake-lulu.js';
import { mapLuluStatus } from './orders.js';

const hasChromium = await chromiumAvailable();

const ADDRESS: ShippingAddress = {
  name: 'Kevin Example',
  street1: '1 Congress Ave',
  city: 'Austin',
  state_code: 'TX',
  postcode: '78701',
  country_code: 'US',
  phone_number: '+1 512 555 0100',
  email: 'kevin@example.com',
};

describe('Lulu ordering', () => {
  let t: TestApp;
  let cookie: string;
  let immich: FakeImmich;
  let lulu: FakeLulu;
  let bookId: string;
  let book: Book;
  let ip = 0;
  const client = () => `10.8.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;

  /**
   * A done render without Chromium: a pdf-lib PDF with `pages` pages on disk plus its `renders` row,
   * so the order flow (exports, validation, print job) runs on any machine.
   */
  async function fakeRender(kind: 'print' | 'cover', pages: number, finishedAt = new Date().toISOString()): Promise<string> {
    const id = randomUUID();
    const dir = join(t.config.exportsDir, bookId);
    await mkdir(dir, { recursive: true });
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([612, 612]).drawText(`${kind} page ${i + 1}`, { x: 40, y: 300, size: 24 });
    const filePath = join(dir, `${id}.pdf`);
    const bytes = await doc.save();
    await writeFile(filePath, bytes);
    const geometry = coverGeometry(FORMAT_PRESETS['lulu-square-8.5']!, book.luluProduct, book.pages.length);
    t.app.db
      .insert(renders)
      .values({
        id,
        bookId,
        kind,
        status: 'done',
        pagesTotal: pages,
        pagesDone: pages,
        pageCount: pages,
        fileSizeBytes: bytes.byteLength,
        filePath,
        createdAt: finishedAt,
        startedAt: finishedAt,
        finishedAt,
        ...(kind === 'cover' ? { data: JSON.stringify({ cover: { geometry, pageCount: book.pages.length } }) } : {}),
      })
      .run();
    return id;
  }

  const settingsView = async (): Promise<SettingsView> => SettingsView.parse((await t.app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })).json());

  const waitForOrder = async (oid: string): Promise<OrderView> => {
    await t.app.orders.idle();
    return OrderView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/orders/${oid}`, headers: { cookie } })).json());
  };

  beforeAll(async () => {
    // Originals large enough that preflight has no low-resolution errors (wide frames get cropped onto square pages, so 3400 px keeps every crop above 150 ppi).
    immich = await startFakeImmich({ photos: 14, originalLongEdge: 3400 });
    lulu = await startFakeLulu();
    t = await createTestApp({ LULU_BASE_URL: lulu.url }, { render: { batchSize: 6, webFonts: false }, lulu: { pollIntervalMs: 20, pollTimeoutMs: 5_000, tickerMs: 0 } });
    // The fake Lulu really downloads the exports, so the app must listen on a port and know its public URL.
    const origin = await t.app.listen({ port: 0, host: '127.0.0.1' });
    cookie = await loginCookie(t.app);
    await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: immich.url, apiKey: 'test-api-key-1234' } });
    await t.app.inject({ method: 'PUT', url: '/api/settings/public-url', headers: { cookie }, payload: { publicUrl: origin } });
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Douro weekend', formatId: 'lulu-square-8.5', themeId: 'warm-editorial', rules: { sources: [{ kind: 'album', albumIds: ['album-trip'] }], targetPages: 24 } },
    });
    bookId = Book.parse(created.json()).id;
    const laid = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: {} });
    expect(laid.statusCode, laid.body).toBe(200);
    book = t.app.books.get(bookId)!;
    expect(book.pages).toHaveLength(24);
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await immich.close();
    await lulu.close();
  });

  /* ---------- Settings and connection test (criterion 1) ---------- */

  it('tests typed credentials against Lulu and reports its message for wrong ones', async () => {
    const wrong = await t.app.inject({ method: 'POST', url: '/api/lulu/test', headers: { cookie }, payload: { env: 'sandbox', clientKey: 'fake-key', clientSecret: 'wrong-secret' } });
    expect(wrong.statusCode, wrong.body).toBe(200);
    const w = LuluStatus.parse(wrong.json());
    expect(w.ok).toBe(false);
    expect(w.error).toMatch(/Invalid client/);
    expect(w.env).toBe('sandbox');

    const right = await t.app.inject({ method: 'POST', url: '/api/lulu/test', headers: { cookie }, payload: { env: 'sandbox', clientKey: 'fake-key', clientSecret: 'fake-secret' } });
    const r = LuluStatus.parse(right.json());
    expect(r.ok).toBe(true);
    expect(r.printJobs).toBe(0);
    expect(r.baseUrl).toBe(lulu.url);
  });

  it('saves separate sandbox and production pairs and tests the active one without a body', async () => {
    const noCreds = await t.app.inject({ method: 'POST', url: '/api/lulu/test', headers: { cookie } });
    expect(noCreds.statusCode).toBe(409);

    const saved = await t.app.inject({ method: 'PUT', url: '/api/settings/lulu', headers: { cookie }, payload: { env: 'sandbox', clientKey: 'fake-key', clientSecret: 'fake-secret' } });
    expect(saved.statusCode, saved.body).toBe(200);
    let view = SettingsView.parse(saved.json());
    expect(view.lulu).toMatchObject({ sandbox: true, clientKeySet: true, sandboxKeySet: true, productionKeySet: false });

    // Switching to production makes the (unset) production pair the active one.
    await t.app.inject({ method: 'PUT', url: '/api/settings/lulu/sandbox', headers: { cookie }, payload: { sandbox: false } });
    view = await settingsView();
    expect(view.lulu).toMatchObject({ sandbox: false, clientKeySet: false, sandboxKeySet: true });
    expect((await t.app.inject({ method: 'POST', url: '/api/lulu/test', headers: { cookie } })).statusCode).toBe(409);
    await t.app.inject({ method: 'PUT', url: '/api/settings/lulu/sandbox', headers: { cookie }, payload: { sandbox: true } });

    const stored = await t.app.inject({ method: 'POST', url: '/api/lulu/test', headers: { cookie } });
    expect(LuluStatus.parse(stored.json()).ok).toBe(true);
    // Secrets never appear in the settings view or the database in clear text.
    expect(JSON.stringify(view)).not.toContain('fake-secret');
    expect(t.app.settings.getLuluCredentials('sandbox')?.clientSecret).toBe('fake-secret');
  });

  it('caches the token and retries once with a fresh one after a 401', async () => {
    const { createLuluClient } = await import('./client.js');
    const c = createLuluClient({ env: 'sandbox', clientKey: 'fake-key', clientSecret: 'fake-secret', baseUrl: lulu.url });
    const tokenCalls = () => lulu.requests.filter((r) => r.path.endsWith('/token')).length;
    const before = tokenCalls();
    await c.listPrintJobs({ page_size: 1 });
    await c.listPrintJobs({ page_size: 1 });
    expect(tokenCalls()).toBe(before + 1);
    lulu.revokeTokens();
    const list = await c.listPrintJobs({ page_size: 1 });
    expect(list.count).toBe(0);
    expect(tokenCalls()).toBe(before + 2);
  });

  /* ---------- Public exports (criterion 2) ---------- */

  it('streams exports without auth, 404 for unknown tokens, 410 after expiry, with a matching md5', async () => {
    const printId = await fakeRender('print', 24);
    const filePath = t.app.renders.filePath(printId)!;
    const row = await t.app.exports.create({ bookId, renderId: printId, filePath });
    expect(row.token).toHaveLength(64);
    expect(row.md5).toBe(createHash('md5').update(await readFile(filePath)).digest('hex'));

    const res = await t.app.inject({ method: 'GET', url: `/public/exports/${row.token}.pdf`, remoteAddress: client() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(100);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('md5').update(res.rawPayload).digest('hex')).toBe(row.md5);
    expect(t.app.exports.get(row.id)?.downloads).toBe(1);

    expect((await t.app.inject({ method: 'GET', url: `/public/exports/${'x'.repeat(64)}.pdf`, remoteAddress: client() })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/public/exports/short.pdf', remoteAddress: client() })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/public/anything', remoteAddress: client() })).statusCode).toBe(404);

    const expired = await t.app.exports.create({ bookId, renderId: printId, filePath, ttlMs: 1000 }, Date.now() - 5000);
    const gone = await t.app.inject({ method: 'GET', url: `/public/exports/${expired.token}.pdf`, remoteAddress: client() });
    expect(gone.statusCode).toBe(410);
    expect(gone.json()).toMatchObject({ reason: 'expired' });
  });

  /* ---------- Reachability (criterion 6) ---------- */

  it('reports a reachable public URL, and HTML instead of a PDF as a Cloudflare Access failure', async () => {
    const ok = await t.app.inject({ method: 'POST', url: '/api/lulu/reachability', headers: { cookie } });
    expect(ok.statusCode, ok.body).toBe(200);
    const good = ReachabilityReport.parse(ok.json());
    expect(good.ok).toBe(true);
    expect(good.isPdf).toBe(true);
    expect(good.status).toBe(200);
    expect(good.url).toMatch(/\/public\/exports\/[A-Za-z0-9_-]{64}\.pdf$/);
    // The probe export is removed afterwards.
    expect(t.app.exports.byToken(good.url.split('/exports/')[1]!.replace(/\.pdf$/, ''))).toBeUndefined();

    // An "Access" login page in front of the app: HTML with a 200.
    const { checkReachability } = await import('./reachability.js');
    const html = await checkReachability({
      exports: t.app.exports,
      exportsDir: t.config.exportsDir,
      publicBase: 'https://books.example.com',
      fetch: async () => new Response('<!DOCTYPE html><html><body>Sign in with Cloudflare Access</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    expect(html.ok).toBe(false);
    expect(html.isPdf).toBe(false);
    expect(html.error).toMatch(/HTML page instead of the PDF/);
    expect(html.hint).toMatch(/Cloudflare Access/);

    const redirect = await checkReachability({
      exports: t.app.exports,
      exportsDir: t.config.exportsDir,
      publicBase: 'https://books.example.com',
      fetch: async () => new Response('', { status: 302, headers: { location: 'https://team.cloudflareaccess.com/login' } }),
    });
    expect(redirect.ok).toBe(false);
    expect(redirect.error).toMatch(/redirected/);

    await t.app.inject({ method: 'PUT', url: '/api/settings/public-url', headers: { cookie }, payload: { publicUrl: null } });
    const none = await t.app.inject({ method: 'POST', url: '/api/lulu/reachability', headers: { cookie } });
    expect(none.statusCode).toBe(409);
    await t.app.inject({ method: 'PUT', url: '/api/settings/public-url', headers: { cookie }, payload: { publicUrl: good.url.split('/public/')[0] } });
  });

  /* ---------- Orders (criteria 3 and 4) ---------- */

  it('refuses to prepare an order without current print and cover renders', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders`, headers: { cookie }, payload: { shippingAddress: ADDRESS } });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().message).toMatch(/cover PDF/);
    const bad = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders`, headers: { cookie }, payload: { shippingAddress: { ...ADDRESS, phone_number: '12' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/phone_number/);
  });

  it('validates the files through the public exports and quotes the price', async () => {
    await fakeRender('cover', 1);
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders`, headers: { cookie }, payload: { quantity: 2, shippingLevel: 'PRIORITY_MAIL', shippingAddress: ADDRESS } });
    expect(res.statusCode, res.body).toBe(202);
    const created = OrderView.parse(res.json());
    expect(created.status).toBe('validating');
    expect(created.podPackageId).toBe('0850X0850.FC.PRE.CW.080CW444.MXX');
    expect(created.pageCount).toBe(24);
    expect(created.exports?.interior).toMatch(/\/public\/exports\/[A-Za-z0-9_-]{64}\.pdf$/);
    expect(created.env).toBe('sandbox');
    expect(created.externalId).toBe(`${bookId}:${created.id}`);

    const quoted = await waitForOrder(created.id);
    expect(quoted.status, JSON.stringify(quoted.messages)).toBe('quoted');
    expect(quoted.validation.interior).toMatchObject({ status: 'ok', pageCount: 24 });
    expect(quoted.validation.cover).toMatchObject({ status: 'ok' });
    expect(quoted.cost?.currency).toBe('USD');
    expect(quoted.cost?.lineItems[0]?.quantity).toBe(2);
    expect(Number(quoted.cost?.totalInclTax)).toBeGreaterThan(Number(quoted.cost?.totalExclTax));
    expect(quoted.cost?.shipping.exclTax).toBe('7.99');
    expect(quoted.shippingOptions.map((o) => o.level)).toContain('GROUND');
    expect(quoted.shippingOptions.find((o) => o.level === 'MAIL')?.cost).toBe('3.99');
    // The fake really downloaded both files from this server, and their md5s match the export rows.
    for (const url of [quoted.exports!.interior, quoted.exports!.cover]) {
      const token = url.split('/exports/')[1]!.replace(/\.pdf$/, '');
      expect(lulu.downloads.get(url)?.md5).toBe(t.app.exports.byToken(token)?.md5);
    }
    // The address is remembered for the next order.
    expect((await settingsView()).lulu.lastAddress).toEqual(ADDRESS);
    const list = z.array(OrderView).parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/orders`, headers: { cookie } })).json());
    expect(list.map((o) => o.id)).toContain(created.id);
  });

  it('surfaces a validation failure as rejected with Lulu messages', async () => {
    lulu.behaviour.interiorErrors = ['Page size 8.5x8.5in does not match the product', 'Fonts not embedded'];
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders`, headers: { cookie }, payload: { shippingAddress: ADDRESS } });
    expect(res.statusCode, res.body).toBe(202);
    const order = await waitForOrder(OrderView.parse(res.json()).id);
    expect(order.status).toBe('rejected');
    expect(order.validation.interior?.errors).toHaveLength(2);
    expect(order.error).toMatch(/Fonts not embedded/);
    expect(order.messages.at(-1)?.source).toBe('lulu');
    // Nothing to submit.
    const submit = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders/${order.id}/submit`, headers: { cookie } });
    expect(submit.statusCode).toBe(409);
  });

  it('submits a quoted order, follows the fake to shipped with tracking, and cancels only while unpaid', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders`, headers: { cookie }, payload: { shippingAddress: ADDRESS } });
    const quoted = await waitForOrder(OrderView.parse(res.json()).id);
    expect(quoted.status).toBe('quoted');

    const submitted = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders/${quoted.id}/submit`, headers: { cookie } });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const s = OrderView.parse(submitted.json());
    expect(s.luluJobId).toBeTruthy();
    // submit polls once, and the fake advances a step per poll: CREATED -> UNPAID.
    expect(s.luluStatus).toBe('UNPAID');
    expect(s.status).toBe('unpaid');
    expect(s.payUrl).toBe('https://developers.sandbox.lulu.com/print-jobs');
    expect(t.app.books.get(bookId)?.status).toBe('ordered');
    const job = lulu.jobs.get(Number(s.luluJobId))!;
    expect(job.externalId).toBe(s.externalId);
    expect((job.body['line_items'] as Array<{ title: string; quantity: number }>)[0]).toMatchObject({ title: 'Douro weekend', quantity: 1 });

    // Cancel is refused once production started; first walk another order there.
    const again = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders`, headers: { cookie }, payload: { shippingAddress: ADDRESS } });
    const q2 = await waitForOrder(OrderView.parse(again.json()).id);
    const s2 = OrderView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders/${q2.id}/submit`, headers: { cookie } })).json());
    let cur = s2;
    const seen: string[] = [cur.luluStatus!];
    for (let i = 0; i < 6 && cur.status !== 'shipped'; i++) {
      cur = OrderView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders/${q2.id}/refresh`, headers: { cookie } })).json());
      seen.push(cur.luluStatus!);
    }
    expect(seen).toEqual(['UNPAID', 'PAYMENT_IN_PROGRESS', 'PRODUCTION_READY', 'IN_PRODUCTION', 'SHIPPED']);
    expect(cur.status).toBe('shipped');
    expect(cur.tracking).toHaveLength(1);
    expect(cur.tracking[0]!.url).toContain('/printer-wannabe-tracking/');
    expect(cur.tracking[0]!.carrier).toBe('Fake Carrier');
    for (const name of ['CREATED', 'UNPAID', 'PRODUCTION_READY', 'IN_PRODUCTION', 'SHIPPED']) expect(mapLuluStatus(name)).toBeDefined();
    const noCancel = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders/${q2.id}/cancel`, headers: { cookie } });
    expect(noCancel.statusCode).toBe(409);

    // The first order is still unpaid: Lulu accepts the cancellation.
    const canceled = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders/${quoted.id}/cancel`, headers: { cookie } });
    expect(canceled.statusCode, canceled.body).toBe(200);
    expect(OrderView.parse(canceled.json())).toMatchObject({ status: 'canceled', luluStatus: 'CANCELED' });
    expect(lulu.jobs.get(Number(s.luluJobId))?.status).toBe('CANCELED');

    // Background refresh touches only orders that still move.
    expect(await t.app.orders.refreshActive()).toBe(0);
  });

  it('rejects a print job whose md5 no longer matches the file', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders`, headers: { cookie }, payload: { shippingAddress: ADDRESS } });
    const quoted = await waitForOrder(OrderView.parse(res.json()).id);
    // Tamper with the export row so the md5 Lulu checks is wrong.
    const token = quoted.exports!.interior.split('/exports/')[1]!.replace(/\.pdf$/, '');
    const row = t.app.exports.byToken(token)!;
    const { exports: exportsTable } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    t.app.db.update(exportsTable).set({ md5: 'deadbeef' }).where(eq(exportsTable.id, row.id)).run();
    const submitted = OrderView.parse((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/orders/${quoted.id}/submit`, headers: { cookie } })).json());
    expect(submitted.status).toBe('rejected');
    expect(submitted.error).toMatch(/md5/);
  });

  /* ---------- Cover dimensions (criterion 5) ---------- */

  it.skipIf(!hasChromium)('sizes the cover PDF with the dimensions Lulu returns', async () => {
    const q = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'cover' } });
    expect(q.statusCode, q.body).toBe(202);
    await t.app.renders.idle();
    const job = RenderJob.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${RenderJob.parse(q.json()).id}`, headers: { cookie } })).json());
    expect(job.status, job.error).toBe('done');
    expect(job.warnings).not.toContain(SPINE_ESTIMATED_WARNING);
    const g = job.data?.cover?.geometry;
    const expected = fakeCoverDimensionsIn('0850X0850.FC.PRE.CW.080CW444.MXX', 24)!;
    expect(g?.source).toBe('lulu');
    expect(g?.widthIn).toBeCloseTo(expected.width, 2);
    expect(g?.heightIn).toBeCloseTo(expected.height, 2);
    expect(g?.wrapIn).toBeCloseTo(0.6875, 3);
    expect(lulu.requests.some((r) => r.path === '/cover-dimensions/')).toBe(true);
    // The PDF page really has that size (points).
    const pdf = await PDFDocument.load(await readFile(t.app.renders.filePath(job.id)!));
    expect(pdf.getPage(0).getWidth() / 72).toBeCloseTo(expected.width, 1);

    // Without credentials the estimate is used and the warning says so.
    await t.app.inject({ method: 'DELETE', url: '/api/settings/lulu?env=sandbox', headers: { cookie } });
    const q2 = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'cover' } });
    await t.app.renders.idle();
    const job2 = RenderJob.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${RenderJob.parse(q2.json()).id}`, headers: { cookie } })).json());
    expect(job2.data?.cover?.geometry.source).toBe('estimate');
    expect(job2.warnings).toContain(SPINE_ESTIMATED_WARNING);
  }, 120_000);
});

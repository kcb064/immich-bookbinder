import { Book, BookAsset, FORMAT_PRESETS, Preflight, RenderJob } from '@bookbinder/shared';
import { coverGeometry, placedAssetIds } from '@bookbinder/layout';
import { readdirSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromiumAvailable } from '../render/renderer.js';
import { createTestApp, loginCookie, type TestApp } from '../test/helpers.js';
import { startFakeImmich, type FakeImmich } from '../test/fake-immich.js';

const LayoutResponse = z.object({ book: Book, warnings: z.array(z.string()), photoCount: z.number() });
const hasChromium = await chromiumAvailable();

describe('album → layout → render', () => {
  let t: TestApp;
  let cookie: string;
  let immich: FakeImmich;
  let bookId: string;

  beforeAll(async () => {
    immich = await startFakeImmich({ photos: 26, originalLongEdge: 1200 });
    t = await createTestApp({}, { render: { batchSize: 4, webFonts: false } });
    cookie = await loginCookie(t.app);
    const saved = await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: immich.url, apiKey: 'test-api-key-1234' } });
    expect(saved.statusCode).toBe(200);
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Portugal 2026', formatId: 'lulu-square-8.5', themeId: 'warm-editorial', rules: { sources: [{ kind: 'album', albumIds: ['album-trip'] }], targetPages: 24 } },
    });
    bookId = Book.parse(created.json()).id;
  });
  afterAll(async () => {
    await t.cleanup();
    await immich.close();
  });

  it('refuses to render before the layout exists', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'proof' } });
    expect(res.statusCode).toBe(409);
  });

  it('gathers the album and lays it out chronologically', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    const { book, warnings, photoCount } = LayoutResponse.parse(res.json());
    expect(photoCount).toBe(26);
    expect(warnings).toEqual([]);
    expect(book.status).toBe('editing');
    expect(book.pages.length).toBe(24);
    expect(book.pages[0]!.templateId).toBe('title-page');
    expect(placedAssetIds(book.pages)).toHaveLength(26);
    // A Lulu book gets a default cover: the hero is one of the placed photos, text falls back to the book.
    expect(book.cover?.templateId).toBe('cover-editorial');
    expect(placedAssetIds(book.pages)).toContain(book.cover?.slots[0]?.assetId);

    const assets = z.array(BookAsset).parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/assets`, headers: { cookie } })).json());
    expect(assets).toHaveLength(26);
    expect(assets[0]!.fileName).toBe('IMG_4000.JPG');

    const list = (await t.app.inject({ method: 'GET', url: '/api/books', headers: { cookie } })).json();
    expect(list[0]).toMatchObject({ id: bookId, status: 'editing', pageCount: 24, photoCount: 26 });
  });

  it('re-lays out from the stored photos without calling Immich again', async () => {
    const before = immich.requests.length;
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: { refetch: false } });
    expect(res.statusCode).toBe(200);
    expect(immich.requests.length).toBe(before);
    // The cover survives a re-layout.
    expect(LayoutResponse.parse(res.json()).book.cover?.slots[0]?.assetId).toBeTruthy();
    const again = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: { refetch: true } });
    expect(again.statusCode).toBe(200);
    expect(immich.requests.length).toBeGreaterThan(before);
  });

  it('rejects a save that places one asset twice', async () => {
    const book = Book.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}`, headers: { cookie } })).json());
    const firstAsset = placedAssetIds(book.pages)[0]!;
    // Another page that holds a photo (chapter title pages and blanks hold none).
    const target = book.pages.findIndex((p) => p.slots.some((s) => s.assetId && s.assetId !== firstAsset));
    const pages = book.pages.map((p, i) => (i === target ? { ...p, slots: p.slots.map((s) => (s.assetId ? { ...s, assetId: firstAsset } : s)) } : p));
    const res = await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}`, headers: { cookie }, payload: { ...book, pages } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/placed more than once/);
  });

  it('answers 422 for an album with no photos and 409 without Immich', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Empty', formatId: 'lulu-square-8.5', themeId: 'warm-editorial', rules: { sources: [{ kind: 'album', albumIds: ['album-empty'] }] } },
    });
    const id = Book.parse(created.json()).id;
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${id}/layout`, headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(422);

    await t.app.inject({ method: 'DELETE', url: '/api/settings/immich', headers: { cookie } });
    const noImmich = await t.app.inject({ method: 'POST', url: `/api/books/${id}/layout`, headers: { cookie }, payload: {} });
    expect(noImmich.statusCode).toBe(409);
    await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: immich.url, apiKey: 'test-api-key-1234' } });
  });

  it.skipIf(!hasChromium)('renders a proof PDF with one page per book page at trim + bleed', async () => {
    const queued = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'proof' } });
    expect(queued.statusCode, queued.body).toBe(202);
    const job = RenderJob.parse(queued.json());
    expect(job.status).toBe('queued');
    expect(job.pagesTotal).toBe(24);

    await t.app.renders.idle();
    const done = RenderJob.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${job.id}`, headers: { cookie } })).json());
    expect(done.error).toBeUndefined();
    expect(done.status).toBe('done');
    expect(done.pageCount).toBe(24);
    expect(done.pagesDone).toBe(24);
    expect(done.warnings).toEqual([]);
    expect(done.downloadUrl).toBe(`/api/books/${bookId}/renders/${job.id}/pdf`);

    const pdf = await t.app.inject({ method: 'GET', url: done.downloadUrl!, headers: { cookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('portugal-2026-proof.pdf');
    const doc = await PDFDocument.load(pdf.rawPayload);
    expect(doc.getPageCount()).toBe(24);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(8.75 * 72, 0);
    expect(height).toBeCloseTo(8.75 * 72, 0);
    expect(doc.getTitle()).toBe('Portugal 2026');
    // Every photo in the book went through the image pipeline: originals are not touched for proofs.
    expect(immich.requests.some((r) => r.path.includes('/original'))).toBe(false);
    expect(immich.requests.filter((r) => r.path.endsWith('/thumbnail')).length).toBeGreaterThanOrEqual(26);

    const list = z.array(RenderJob).parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders`, headers: { cookie } })).json());
    expect(list.map((r) => r.id)).toContain(job.id);

    const del = await t.app.inject({ method: 'DELETE', url: `/api/books/${bookId}/renders/${job.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: done.downloadUrl!, headers: { cookie } })).statusCode).toBe(404);
  }, 120_000);

  it.skipIf(!hasChromium)('renders a print PDF from originals and marks the book rendered', async () => {
    const queued = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'print' } });
    expect(queued.statusCode).toBe(202);
    await t.app.renders.idle();
    const job = RenderJob.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${RenderJob.parse(queued.json()).id}`, headers: { cookie } })).json());
    expect(job.status, job.error).toBe('done');
    expect(immich.requests.some((r) => r.path.includes('/original'))).toBe(true);
    const book = Book.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}`, headers: { cookie } })).json());
    expect(book.status).toBe('rendered');
  }, 120_000);

  it('reports print readiness for the laid-out book', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/preflight`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const p = Preflight.parse(res.json());
    // 24 pages and a cover document, but the fake's 1200 px originals print soft: resolution errors
    // with page links, plus the missing-render warnings.
    expect(p.ok).toBe(false);
    for (const item of p.items) expect(['low-resolution', 'cover-missing', 'render-missing']).toContain(item.code);
    const res1 = p.items.find((i) => i.code === 'low-resolution');
    expect(res1).toMatchObject({ level: 'error', pageIndex: expect.any(Number), slotId: expect.any(String) });
    // The print render above is newer than the book (marking it "rendered" must not bump updatedAt).
    expect(p.items.filter((i) => i.code === 'render-missing')).toHaveLength(hasChromium ? 0 : 1);
    expect(p.items.filter((i) => i.code === 'cover-missing')).toHaveLength(1);
  });

  it('refuses a cover render for a home-print format', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Home', formatId: 'home-letter', themeId: 'warm-editorial', rules: { sources: [{ kind: 'album', albumIds: ['album-trip'] }], targetPages: 12 } },
    });
    const id = Book.parse(created.json()).id;
    const laid = await t.app.inject({ method: 'POST', url: `/api/books/${id}/layout`, headers: { cookie }, payload: {} });
    expect(laid.statusCode).toBe(200);
    expect(LayoutResponse.parse(laid.json()).book.cover).toBeUndefined();
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${id}/renders`, headers: { cookie }, payload: { kind: 'cover' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/home-print format/);
    const preflight = Preflight.parse((await t.app.inject({ method: 'GET', url: `/api/books/${id}/preflight`, headers: { cookie } })).json());
    expect(preflight.items.some((i) => i.code.startsWith('cover'))).toBe(false);
  });

  it.skipIf(!hasChromium)('renders a one-page cover PDF at the estimated cover geometry', async () => {
    const book = Book.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}`, headers: { cookie } })).json());
    const queued = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'cover' } });
    expect(queued.statusCode, queued.body).toBe(202);
    expect(RenderJob.parse(queued.json()).pagesTotal).toBe(1);
    await t.app.renders.idle();
    const job = RenderJob.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${RenderJob.parse(queued.json()).id}`, headers: { cookie } })).json());
    expect(job.status, job.error).toBe('done');
    expect(job.warnings).toEqual([]);
    expect(job.pageCount).toBe(1);
    const g = coverGeometry(FORMAT_PRESETS['lulu-square-8.5']!, book.luluProduct, book.pages.length);
    expect(job.data?.cover).toEqual({ geometry: g, pageCount: 24 });
    expect(g.source).toBe('estimate');

    const pdf = await t.app.inject({ method: 'GET', url: job.downloadUrl!, headers: { cookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-disposition']).toContain('portugal-2026-cover.pdf');
    const doc = await PDFDocument.load(pdf.rawPayload);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(g.widthIn * 72, 0);
    expect(height).toBeCloseTo(g.heightIn * 72, 0);
    expect(doc.getSubject()).toContain('estimate');

    // The cover counts as current in preflight now.
    const p = Preflight.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/preflight`, headers: { cookie } })).json());
    expect(p.items.some((i) => i.code.startsWith('cover'))).toBe(false);
  }, 120_000);

  it.skipIf(!hasChromium)('writes one PNG per page plus the cover for a preview render and serves them', async () => {
    const queued = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'preview' } });
    expect(queued.statusCode, queued.body).toBe(202);
    const id = RenderJob.parse(queued.json()).id;
    expect(RenderJob.parse(queued.json()).pagesTotal).toBe(25);
    await t.app.renders.idle();
    const job = RenderJob.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${id}`, headers: { cookie } })).json());
    expect(job.status, job.error).toBe('done');
    expect(job.pageCount).toBe(24);
    expect(job.pagesDone).toBe(25);
    expect(job.data).toEqual({ hasCover: true });
    expect(job.downloadUrl).toBeUndefined();
    expect(job.fileSizeBytes).toBeGreaterThan(24 * 1000);
    const dir = t.app.renders.filePath(id)!;
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(25);
    expect(files[0]).toBe('0000.png');
    expect(files[23]).toBe('0023.png');
    expect(files).toContain('cover.png');

    const png = await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${id}/pages/3.png`, headers: { cookie } });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    const meta = await sharp(png.rawPayload).metadata();
    expect(Math.abs(Math.max(meta.width ?? 0, meta.height ?? 0) - 1600)).toBeLessThanOrEqual(1);
    const cover = await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${id}/cover.png`, headers: { cookie } });
    expect(cover.statusCode).toBe(200);
    const cm = await sharp(cover.rawPayload).metadata();
    expect(Math.abs(cm.width! - 1600)).toBeLessThanOrEqual(1);
    expect(cm.width! > cm.height!).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${id}/pages/24.png`, headers: { cookie } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${id}/pdf`, headers: { cookie } })).statusCode).toBe(409);

    // Deleting a preview removes the directory.
    expect((await t.app.inject({ method: 'DELETE', url: `/api/books/${bookId}/renders/${id}`, headers: { cookie } })).statusCode).toBe(204);
    expect(() => readdirSync(dir)).toThrow();
  }, 180_000);
});

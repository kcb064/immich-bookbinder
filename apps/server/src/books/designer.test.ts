import { Book, Preflight, RenderJob, type Page } from '@bookbinder/shared';
import { placedAssetIds } from '@bookbinder/layout';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromiumAvailable } from '../render/renderer.js';
import { createTestApp, loginCookie, type TestApp } from '../test/helpers.js';
import { startFakeImmich, type FakeImmich } from '../test/fake-immich.js';

const LayoutResponse = z.object({ book: Book, warnings: z.array(z.string()), photoCount: z.number() });
const hasChromium = await chromiumAvailable();

/** Top-left quadrant of the page, in template units: 0.4 of the trim from 5% in. */
const FRAME = { x: 0.05, y: 0.05, w: 0.4, h: 0.4 };
const PAPER = { r: 0xf6, g: 0xf1, b: 0xe8 };

describe('free-form designer (M6): overrides round-trip, survive re-layout and render', () => {
  let t: TestApp;
  let cookie: string;
  let immich: FakeImmich;
  let bookId: string;
  let customPageId: string;
  let customIndex: number;
  let framedAsset: string;
  let freedAssets: string[];

  beforeAll(async () => {
    immich = await startFakeImmich({ photos: 26, originalLongEdge: 1200 });
    t = await createTestApp({}, { render: { batchSize: 4, webFonts: false } });
    cookie = await loginCookie(t.app);
    await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: immich.url, apiKey: 'test-api-key-1234' } });
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Designed', formatId: 'lulu-square-8.5', themeId: 'warm-editorial', rules: { sources: [{ kind: 'album', albumIds: ['album-trip'] }], targetPages: 24 } },
    });
    bookId = Book.parse(created.json()).id;
    const laid = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: {} });
    expect(laid.statusCode, laid.body).toBe(200);
  });
  afterAll(async () => {
    await t.cleanup();
    await immich.close();
  });

  const getBook = async (): Promise<Book> => Book.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}`, headers: { cookie } })).json());

  it('stores frames, ad-hoc boxes and the custom flag exactly as sent', async () => {
    const book = await getBook();
    // The first body page with photos: keep its first photo in a hand-placed frame, free the others, add a text box.
    const page = book.pages.find((p) => p.index >= 1 && p.templateId !== 'chapter-photo' && p.slots.some((s) => s.assetId))!;
    customIndex = page.index;
    const ids = page.slots.filter((s) => s.assetId).map((s) => s.assetId!);
    framedAsset = ids[0]!;
    freedAssets = ids.slice(1);
    customPageId = page.id;
    const custom: Page = {
      ...page,
      templateId: 'one-up-full-bleed',
      custom: true,
      slots: [
        { slotId: 'p1', assetId: framedAsset, frame: { ...FRAME, rotation: 0, z: 1 } },
        { slotId: 'text-note', role: 'text', text: 'Hand placed', frame: { x: 0.5, y: 0.6, w: 0.4, h: 0.1 }, style: { font: 'display', sizePt: 18, align: 'right', italic: true } },
      ],
    };
    const pages = book.pages.map((p) => (p.id === page.id ? custom : p));
    const put = await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}`, headers: { cookie }, payload: { ...book, pages } });
    expect(put.statusCode, put.body).toBe(200);
    const saved = await getBook();
    expect(saved.pages.find((p) => p.id === page.id)).toEqual(custom);
    expect(placedAssetIds(saved.pages)).toHaveLength(26 - freedAssets.length);

    // Bad frames are refused by the schema.
    const bad = await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}`, headers: { cookie }, payload: { ...saved, pages: saved.pages.map((p) => (p.id === page.id ? { ...p, slots: [{ slotId: 'p1', assetId: framedAsset, frame: { x: 0, y: 0, w: 0, h: 1 } }] } : p)) } });
    expect(bad.statusCode).toBe(400);
  });

  it('grades resolution from the frame in preflight', async () => {
    const p = Preflight.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/preflight`, headers: { cookie } })).json());
    // The framed photo is 1200 px over 3.4 in: about 350 ppi, so the custom page is not flagged while full-bleed pages are.
    expect(p.items.some((i) => i.code === 'low-resolution' && i.pageIndex === customIndex)).toBe(false);
    expect(p.items.some((i) => i.code === 'low-resolution')).toBe(true);
  });

  it('keeps the custom page through a re-layout without placing its photo twice', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    const { book, warnings } = LayoutResponse.parse(res.json());
    expect(warnings).toEqual(['1 hand-designed page was kept as it is.']);
    const kept = book.pages.find((p) => p.id === customPageId)!;
    expect(kept.index).toBe(customIndex);
    expect(kept.custom).toBe(true);
    expect(kept.slots.find((s) => s.slotId === 'p1')?.frame).toMatchObject(FRAME);
    expect(kept.slots.find((s) => s.slotId === 'text-note')?.text).toBe('Hand placed');
    const placed = placedAssetIds(book.pages);
    expect(placed.filter((id) => id === framedAsset)).toHaveLength(1);
    // The freed photos are placed again by the automatic layout; every photo is on exactly one page.
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed).toHaveLength(26);
    expect(book.pages.length % 2).toBe(0);
    expect(book.pages[0]!.templateId).toBe('title-page');
  });

  it.skipIf(!hasChromium)('renders the framed photo where the frame says in the preview PNG and the print PDF', async () => {
    const queued = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'preview' } });
    expect(queued.statusCode, queued.body).toBe(202);
    const id = RenderJob.parse(queued.json()).id;
    await t.app.renders.idle();
    const job = RenderJob.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${id}`, headers: { cookie } })).json());
    expect(job.status, job.error).toBe('done');

    const png = await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${id}/pages/${customIndex}.png`, headers: { cookie } });
    expect(png.statusCode).toBe(200);
    const img = sharp(png.rawPayload);
    const { width } = await img.metadata();
    const pxPerIn = width! / 8.75;
    const raw = await img.raw().toBuffer({ resolveWithObject: true });
    const at = (xIn: number, yIn: number) => {
      const x = Math.round(xIn * pxPerIn);
      const y = Math.round(yIn * pxPerIn);
      const i = (y * raw.info.width + x) * raw.info.channels;
      return { r: raw.data[i]!, g: raw.data[i + 1]!, b: raw.data[i + 2]! };
    };
    const isPaper = (c: { r: number; g: number; b: number }) => Math.abs(c.r - PAPER.r) < 6 && Math.abs(c.g - PAPER.g) < 6 && Math.abs(c.b - PAPER.b) < 6;
    // Frame in inches from the sheet corner: bleed + 5% of 8.5 = 0.55 in, 3.4 in square.
    const left = 0.125 + FRAME.x * 8.5;
    const size = FRAME.w * 8.5;
    const inside = [at(left + size / 2, left + size / 2), at(left + 0.1, left + 0.1), at(left + size - 0.1, left + size - 0.1)];
    expect(inside.every((c) => !isPaper(c)), JSON.stringify(inside)).toBe(true);
    const outside = [at(left + size + 0.3, left + 0.5), at(7, 7), at(1, 7.5), at(left + 0.5, left + size + 0.3)];
    expect(outside.every(isPaper), JSON.stringify(outside)).toBe(true);
    // Text box: the display face draws ink somewhere in its right-aligned box (x 0.5..0.9, y 0.6..0.7 of the trim).
    let inked = 0;
    for (let x = 0.125 + 0.5 * 8.5; x < 0.125 + 0.9 * 8.5; x += 0.05) for (let y = 0.125 + 0.6 * 8.5; y < 0.125 + 0.7 * 8.5; y += 0.05) if (!isPaper(at(x, y))) inked++;
    expect(inked).toBeGreaterThan(5);

    const print = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/renders`, headers: { cookie }, payload: { kind: 'print' } });
    expect(print.statusCode).toBe(202);
    await t.app.renders.idle();
    const printJob = RenderJob.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/renders/${RenderJob.parse(print.json()).id}`, headers: { cookie } })).json());
    expect(printJob.status, printJob.error).toBe('done');
    expect(printJob.warnings).toEqual([]);
    const pdf = await t.app.inject({ method: 'GET', url: printJob.downloadUrl!, headers: { cookie } });
    const doc = await PDFDocument.load(pdf.rawPayload);
    expect(doc.getPageCount()).toBe(printJob.pageCount);
  }, 240_000);
});

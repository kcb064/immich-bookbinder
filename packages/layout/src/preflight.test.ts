import { FORMAT_PRESETS, type Book, type BookAsset, type CoverGeometry, type Page } from '@bookbinder/shared';
import { describe, expect, it } from 'vitest';
import { paginate } from './paginate.js';
import { isCurrentRender, preflightBook, type PreflightRender } from './preflight.js';

const square = FORMAT_PRESETS['lulu-square-8.5']!;
const geometry: CoverGeometry = { widthIn: 18.86, heightIn: 10, spineIn: 0.36, wrapIn: 0.75, frontLeftIn: 9.61, source: 'estimate' };

/** `edge` > 0 makes every photo a square of that many pixels (so the worst slot is the full-bleed page). */
function fixture(n = 26, edge = 0): { book: Pick<Book, 'pages' | 'cover' | 'updatedAt'>; assets: Map<string, BookAsset> } {
  const assets = new Map<string, BookAsset>();
  for (let i = 0; i < n; i++) {
    const landscape = i % 3 !== 1;
    assets.set(`a${i}`, {
      id: `a${i}`,
      people: [],
      isFavorite: false,
      width: edge || (landscape ? 6000 : 4000),
      height: edge || (landscape ? 4000 : 6000),
      ratio: edge ? 1 : landscape ? 1.5 : 0.667,
      takenAt: new Date(Date.UTC(2026, 4, 12 + Math.floor(i / 4), 10, i)).toISOString(),
      fileName: `IMG_${1000 + i}.JPG`,
    });
  }
  let c = 0;
  const { pages } = paginate(
    [...assets.values()].map((a) => ({ id: a.id, ratio: a.ratio, takenAt: a.takenAt })),
    { format: square, targetPages: 24, makeId: () => `p${c++}` },
  );
  return {
    book: { pages, cover: { templateId: 'cover-editorial', slots: [{ slotId: 'p1', assetId: 'a0' }] }, updatedAt: '2026-09-14T10:00:00.000Z' },
    assets,
  };
}

/** Pages the fixture lays out (title, body, colophon, padding). */
const N = fixture().book.pages.length;

const done = (kind: PreflightRender['kind'], finishedAt: string, extra: Partial<PreflightRender> = {}): PreflightRender => ({ kind, status: 'done', finishedAt, ...extra });
const coverRender = (pageCount: number, finishedAt = '2026-09-14T11:00:00.000Z'): PreflightRender => done('cover', finishedAt, { data: { cover: { pageCount, geometry } } });
const printRender = (finishedAt = '2026-09-14T11:00:00.000Z'): PreflightRender => done('print', finishedAt);

describe('preflightBook', () => {
  it('passes a well-formed book with current renders', () => {
    const { book, assets } = fixture();
    const p = preflightBook({ book, format: square, assets, renders: [printRender(), coverRender(N)] });
    expect(p.items).toEqual([]);
    expect(p.ok).toBe(true);
  });

  it('warns when cover text or a photo box leaves the safe area, crosses the spine or sits on the wrap (M7)', () => {
    const { book, assets } = fixture();
    const ok = preflightBook({ book, format: square, assets, renders: [printRender(), coverRender(N)] });
    expect(ok.items.filter((i) => i.code === 'cover-safety')).toEqual([]);
    // Title dragged onto the spine: x from -0.1 straddles back and front.
    const onSpine = { ...book, cover: { ...book.cover!, slots: [...book.cover!.slots, { slotId: 'title', frame: { x: -0.1, y: 0.4, w: 0.4, h: 0.15 } }] } };
    const p1 = preflightBook({ book: onSpine, format: square, assets, renders: [printRender(), coverRender(N)] });
    expect(p1.items.find((i) => i.code === 'cover-safety')?.message).toMatch(/The title on the cover/);
    expect(p1.ok).toBe(true); // a warning, the user's call
    // A text box hanging over the top wrap, and one safely inside the back cover.
    const boxes = { ...book, cover: { ...book.cover!, slots: [...book.cover!.slots, { slotId: 'text-1', role: 'text' as const, text: 'Hi', frame: { x: 0.2, y: -0.05, w: 0.3, h: 0.1 } }, { slotId: 'text-2', role: 'text' as const, text: 'Ok', frame: { x: -0.8, y: 0.2, w: 0.3, h: 0.1 } }, { slotId: 'text-3', role: 'text' as const, text: '', frame: { x: 0.2, y: -0.5, w: 0.3, h: 0.1 } }] } };
    const p2 = preflightBook({ book: boxes, format: square, assets, renders: [printRender(), coverRender(N)] });
    expect(p2.items.filter((i) => i.code === 'cover-safety').map((i) => i.slotId)).toEqual(['text-1']);
    // A hand-placed photo box too close to the back cover's spine edge (inner inset 0.5 in).
    const photoBox = { ...book, cover: { ...book.cover!, slots: [...book.cover!.slots, { slotId: 'photo-1', role: 'photo' as const, assetId: 'a1', frame: { x: -0.5, y: 0.2, w: 0.48, h: 0.3 } }] } };
    const p3 = preflightBook({ book: photoBox, format: square, assets, renders: [printRender(), coverRender(N)] });
    expect(p3.items.find((i) => i.code === 'cover-safety')?.message).toMatch(/A photo box/);
    // Home formats have no cover, no check.
    expect(preflightBook({ book: onSpine, format: FORMAT_PRESETS['home-letter']!, assets, renders: [printRender()] }).items.some((i) => i.code === 'cover-safety')).toBe(false);
  });

  it('flags page counts outside the format rules', () => {
    const { book, assets } = fixture();
    const odd = { ...book, pages: book.pages.slice(0, 23) };
    const p = preflightBook({ book: odd, format: square, assets, renders: [printRender(), coverRender(23)] });
    expect(p.ok).toBe(false);
    expect(p.items.find((i) => i.code === 'page-count')?.message).toMatch(/23 pages.*at least 24/);
    const many = { ...book, pages: Array.from({ length: 802 }, (_, i) => ({ ...book.pages[0]!, id: `x${i}`, index: i })) };
    expect(preflightBook({ book: many, format: square, assets, renders: [printRender(), coverRender(802)] }).items[0]?.message).toMatch(/at most 800/);
  });

  it('grades resolution: warn under 200 ppi, error under 150', () => {
    // A 1600 px square on a full-bleed 8.75 in page is ~183 ppi; 1200 px is ~137 ppi.
    const soft = fixture(26, 1600);
    const warn = preflightBook({ book: soft.book, format: square, assets: soft.assets, renders: [printRender(), coverRender(N)] });
    const res = warn.items.filter((i) => i.code === 'low-resolution');
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((i) => i.level === 'warn')).toBe(true);
    expect(res[0]!.pageIndex).toBeTypeOf('number');
    expect(res[0]!.slotId).toBeTypeOf('string');
    expect(warn.ok).toBe(true);

    const bad = fixture(26, 1200);
    const err = preflightBook({ book: bad.book, format: square, assets: bad.assets, renders: [printRender(), coverRender(N)] });
    expect(err.items.some((i) => i.code === 'low-resolution' && i.level === 'error')).toBe(true);
    expect(err.ok).toBe(false);
  });

  it('warns about empty photo slots and captions inside the safety band', () => {
    const { book, assets } = fixture();
    const first = book.pages.findIndex((p) => p.slots.some((s) => s.assetId));
    const pages: Page[] = book.pages.map((p, i) => (i === first ? { ...p, slots: p.slots.slice(1) } : p));
    const p = preflightBook({ book: { ...book, pages }, format: square, assets, renders: [printRender(), coverRender(N)] });
    expect(p.items.filter((i) => i.code === 'empty-slot')).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ level: 'warn', pageIndex: first });

    // Every template keeps its captions at 0.5 in; widen the safety band and they all cross it.
    const wide = { ...square, safetyIn: 0.6 };
    const q = preflightBook({ book, format: wide, assets, renders: [printRender(), coverRender(N)] });
    const caps = q.items.filter((i) => i.code === 'caption-safety');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps[0]).toMatchObject({ level: 'warn', slotId: expect.any(String) });
  });

  it('requires a cover on Lulu formats and notices a stale one', () => {
    const { book, assets } = fixture();
    const noCover = preflightBook({ book: { ...book, cover: undefined }, format: square, assets, renders: [printRender(), coverRender(N)] });
    expect(noCover.items.find((i) => i.code === 'cover-missing')?.level).toBe('error');
    expect(noCover.ok).toBe(false);

    const noRender = preflightBook({ book, format: square, assets, renders: [printRender()] });
    expect(noRender.items.find((i) => i.code === 'cover-missing')?.level).toBe('warn');
    expect(noRender.ok).toBe(true);

    const stale = preflightBook({ book, format: square, assets, renders: [printRender(), coverRender(48)] });
    expect(stale.items.find((i) => i.code === 'cover-stale')?.message).toMatch(new RegExp(`48 pages.*now has ${N}`));

    const older = preflightBook({ book, format: square, assets, renders: [printRender(), coverRender(N, '2026-09-14T09:00:00.000Z')] });
    expect(older.items.find((i) => i.code === 'cover-stale')?.message).toMatch(/changed after/);

    const home = preflightBook({ book: { ...book, cover: undefined }, format: FORMAT_PRESETS['home-letter']!, assets, renders: [printRender()] });
    expect(home.items.some((i) => i.code.startsWith('cover'))).toBe(false);
  });

  it('wants a print render newer than the book', () => {
    const { book, assets } = fixture();
    const none = preflightBook({ book, format: square, assets, renders: [coverRender(N)] });
    expect(none.items.find((i) => i.code === 'render-missing')?.message).toMatch(/No print PDF/);
    const old = preflightBook({ book, format: square, assets, renders: [printRender('2026-09-14T09:00:00.000Z'), coverRender(N)] });
    expect(old.items.find((i) => i.code === 'render-missing')?.message).toMatch(/changed after/);
    const failed = preflightBook({ book, format: square, assets, renders: [{ kind: 'print', status: 'error' }, coverRender(N)] });
    expect(failed.items.some((i) => i.code === 'render-missing')).toBe(true);
  });

  it('treats a render that started before the last edit as stale even when it finished after it', () => {
    const { book, assets } = fixture();
    // The book was saved at 10:00 while a print render that started at 09:30 was still running until 10:30.
    const during = { ...printRender('2026-09-14T10:30:00.000Z'), startedAt: '2026-09-14T09:30:00.000Z' };
    const p = preflightBook({ book, format: square, assets, renders: [during, { ...coverRender(N, '2026-09-14T10:30:00.000Z'), startedAt: '2026-09-14T09:30:00.000Z' }] });
    expect(p.items.find((i) => i.code === 'render-missing')?.message).toMatch(/changed after/);
    expect(p.items.find((i) => i.code === 'cover-stale')?.message).toMatch(/changed after/);
    expect(isCurrentRender(during, book.updatedAt)).toBe(false);
    expect(isCurrentRender({ ...during, startedAt: '2026-09-14T10:00:00.000Z' }, book.updatedAt)).toBe(true);
    expect(isCurrentRender({ status: 'done', finishedAt: '2026-09-14T11:00:00.000Z' }, book.updatedAt)).toBe(true);
    expect(isCurrentRender({ status: 'queued' }, book.updatedAt)).toBe(false);
  });
});

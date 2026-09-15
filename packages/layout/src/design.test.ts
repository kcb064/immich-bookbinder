import { FORMAT_PRESETS, type BookAsset, type Page } from '@bookbinder/shared';
import { describe, expect, it } from 'vitest';
import { adHocSlotId, defaultPhotoFrame, defaultTextFrame, effectiveSlots, frameToIn, hasOverrides, inToFrame, nextZ, pageSlots, roundFrame } from './design.js';
import { CHAPTER_PHOTO_TEMPLATE_ID, CHAPTER_TITLE_TEMPLATE_ID, mergeCustomPages, paginate, placedAssetIds, TITLE_TEMPLATE_ID } from './paginate.js';
import { preflightBook } from './preflight.js';
import { getTemplate } from './templates.js';

const square = FORMAT_PRESETS['lulu-square-8.5']!;

const page = (over: Partial<Page> = {}): Page => ({ id: 'p', index: 3, templateId: 'two-up', slots: [{ slotId: 'p1', assetId: 'a' }, { slotId: 'p2', assetId: 'b' }], ...over });

describe('effective slots', () => {
  it('draws template slots in order with the template box unless a frame overrides it', () => {
    const t = getTemplate('two-up');
    const slots = pageSlots(page());
    expect(slots.map((s) => s.spec.id)).toEqual(['p1', 'p2']);
    expect(slots[0]!.frame).toEqual({ x: t.slots[0]!.x, y: t.slots[0]!.y, w: t.slots[0]!.w, h: t.slots[0]!.h });
    expect(slots.map((s) => s.z)).toEqual([0, 1]);
    expect(slots.every((s) => !s.adHoc)).toBe(true);

    const framed = pageSlots(page({ slots: [{ slotId: 'p1', assetId: 'a', frame: { x: 0.1, y: 0.2, w: 0.3, h: 0.4, rotation: 5, z: 7 } }, { slotId: 'p2', assetId: 'b' }] }));
    expect(framed[0]!.spec).toMatchObject({ id: 'p1', role: 'photo', x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(framed[0]!.z).toBe(7);
    expect(framed[0]!.frame.rotation).toBe(5);
  });

  it('appends ad-hoc photo and text boxes after the template slots and skips ones without a frame', () => {
    const slots = pageSlots(
      page({
        slots: [
          { slotId: 'p1', assetId: 'a' },
          { slotId: 'text-1', role: 'text', text: 'Hello', frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 } },
          { slotId: 'photo-1', role: 'photo', assetId: 'c', frame: { x: 0.5, y: 0.5, w: 0.3, h: 0.2, z: -1 } },
          { slotId: 'text-2', role: 'text', text: 'no frame' },
          { slotId: 'ghost', assetId: 'd' },
        ],
      }),
    );
    expect(slots.map((s) => s.spec.id)).toEqual(['p1', 'p2', 'text-1', 'photo-1']);
    expect(slots[2]!.spec.role).toBe('text');
    expect(slots[2]!.adHoc).toBe(true);
    expect(slots[3]!.spec.role).toBe('photo');
    expect(slots[3]!.z).toBe(-1);
    expect(effectiveSlots('two-up', []).map((s) => s.content)).toEqual([undefined, undefined]);
  });

  it('knows when a page was hand-placed and where the next layer goes', () => {
    expect(hasOverrides(page())).toBe(false);
    expect(hasOverrides(page({ slots: [{ slotId: 'p1', assetId: 'a', frame: { x: 0, y: 0, w: 1, h: 1 } }] }))).toBe(true);
    expect(hasOverrides(page({ slots: [{ slotId: 'text-1', role: 'text', frame: { x: 0, y: 0, w: 1, h: 1 } }] }))).toBe(true);
    expect(nextZ('two-up', page().slots, 'front')).toBe(2);
    expect(nextZ('two-up', page().slots, 'back')).toBe(-1);
    expect(nextZ('blank', [], 'front')).toBe(0);
  });

  it('converts frames to inches and back, rounds them and names ad-hoc slots by role', () => {
    const f = { x: 0.1, y: 0.2, w: 0.5, h: 0.25 };
    const r = frameToIn(f, square);
    expect(r.x).toBeCloseTo(0.85, 9);
    expect(r.y).toBeCloseTo(1.7, 9);
    expect(r.w).toBeCloseTo(4.25, 9);
    expect(r.h).toBeCloseTo(2.125, 9);
    const back = inToFrame(r, square);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(back[k]).toBeCloseTo(f[k], 9);
    expect(roundFrame({ x: 0.123456, y: 0.2, w: 0.5, h: 0.25, rotation: 0.01, z: 2 })).toEqual({ x: 0.1235, y: 0.2, w: 0.5, h: 0.25, z: 2 });
    expect(roundFrame({ x: 0, y: 0, w: 1, h: 1, rotation: 14.96 })).toEqual({ x: 0, y: 0, w: 1, h: 1, rotation: 15 });
    expect(adHocSlotId('text', () => 'abc')).toBe('text-abc');
    expect(adHocSlotId('photo', () => 'abc')).toBe('photo-abc');
    expect(defaultTextFrame().w).toBe(0.6);
    // A 3:2 photo box is 45% wide and keeps its aspect on a square page.
    const pf = defaultPhotoFrame(1.5, square);
    expect(pf.w).toBe(0.45);
    expect(pf.h).toBeCloseTo(0.3, 5);
    expect(pf.x + pf.w / 2).toBeCloseTo(0.5, 5);
  });
});

describe('mergeCustomPages', () => {
  const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, ratio: i % 2 ? 0.667 : 1.5, takenAt: new Date(Date.UTC(2026, 4, 12, 10, i)).toISOString() }));

  it('puts a custom page back at its index, keeps its photos and normalises the count', () => {
    let c = 0;
    const custom: Page = { id: 'custom', index: 5, templateId: 'blank', custom: true, slots: [{ slotId: 'photo-x', role: 'photo', assetId: 'zz', frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }] };
    const fresh = paginate(photos(20), { format: square, targetPages: 24, makeId: () => `f${c++}` }).pages;
    const { pages } = mergeCustomPages(fresh, [custom], square, [], () => `m${c++}`);
    expect(pages[5]).toBe(custom);
    expect(pages.length % 2).toBe(0);
    expect(pages.length).toBeGreaterThanOrEqual(24);
    expect(pages.map((p) => p.index)).toEqual(pages.map((_, i) => i));
    expect(placedAssetIds(pages).filter((id) => id === 'zz')).toHaveLength(1);
    expect(placedAssetIds(pages)).toHaveLength(21);
  });

  it('re-aligns a chapter opener pushed onto a recto and recomputes startsAtPage', () => {
    let c = 0;
    const chapters = [{ id: 'c1', title: 'Lisbon' }];
    const fresh = paginate(
      photos(12).map((p, i) => ({ ...p, chapterId: i >= 6 ? 'c1' : undefined })),
      { format: square, targetPages: 24, chapters, makeId: () => `f${c++}` },
    );
    const opener = fresh.pages.find((p) => p.templateId === CHAPTER_PHOTO_TEMPLATE_ID)!;
    expect(opener.index % 2).toBe(1);
    const custom: Page = { id: 'custom', index: 1, templateId: 'blank', custom: true, slots: [] };
    const merged = mergeCustomPages(fresh.pages, [custom], square, fresh.chapters, () => `m${c++}`);
    const movedOpener = merged.pages.find((p) => p.templateId === CHAPTER_PHOTO_TEMPLATE_ID)!;
    expect(movedOpener.index % 2).toBe(1);
    expect(merged.pages[movedOpener.index + 1]!.templateId).toBe(CHAPTER_TITLE_TEMPLATE_ID);
    expect(merged.chapters[0]!.startsAtPage).toBe(movedOpener.index);
    expect(merged.pages[1]).toBe(custom);
    expect(merged.pages[0]!.templateId).toBe(TITLE_TEMPLATE_ID);
  });

  it('appends custom pages whose index is past the end, keeping the colophon last', () => {
    const custom: Page = { id: 'custom', index: 99, templateId: 'blank', custom: true, slots: [] };
    const fresh = paginate(photos(4), { format: FORMAT_PRESETS['home-letter']!, targetPages: 4 }).pages;
    const { pages } = mergeCustomPages(fresh, [custom], FORMAT_PRESETS['home-letter']!);
    expect(pages[pages.length - 1]!.templateId).toBe('colophon');
    expect(pages[pages.length - 2]).toMatchObject({ id: 'custom', custom: true, index: pages.length - 2 });
    const plain = paginate(photos(4), { format: FORMAT_PRESETS['home-letter']!, targetPages: 4, colophon: false }).pages;
    const merged = mergeCustomPages(plain, [custom], FORMAT_PRESETS['home-letter']!).pages;
    expect(merged[merged.length - 1]).toMatchObject({ id: 'custom', custom: true, index: merged.length - 1 });
  });
});

describe('preflight with frames', () => {
  it('grades resolution from the frame, not the template slot', () => {
    // 1600 px square: full-bleed 8.75 in ≈ 183 ppi (warn); framed to 4 in ≈ 400 ppi (fine); stretched to 12 in ≈ 133 ppi (error).
    const assets = new Map<string, Pick<BookAsset, 'width' | 'height' | 'fileName'>>([['a', { width: 1600, height: 1600, fileName: 'a.jpg' }]]);
    const base = { format: square, assets, renders: [] as never[] };
    const blank: Page[] = Array.from({ length: 23 }, (_, i) => ({ id: `b${i}`, index: i + 1, templateId: 'blank', slots: [] }));
    const at = (frame: { x: number; y: number; w: number; h: number } | undefined) => ({
      pages: [{ id: 'p', index: 0, templateId: 'one-up-full-bleed', custom: Boolean(frame), slots: [{ slotId: 'p1', assetId: 'a', ...(frame ? { frame } : {}) }] }, ...blank],
      updatedAt: '2026-09-14T10:00:00.000Z',
    });
    const codes = (frame: { x: number; y: number; w: number; h: number } | undefined) => preflightBook({ ...base, book: at(frame) }).items.filter((i) => i.code === 'low-resolution').map((i) => i.level);
    expect(codes(undefined)).toEqual(['warn']);
    expect(codes({ x: 0.2, y: 0.2, w: 4 / 8.5, h: 4 / 8.5 })).toEqual([]);
    expect(codes({ x: -0.2, y: 0, w: 12 / 8.5, h: 1 })).toEqual(['error']);
    // An ad-hoc photo box counts too.
    const adHoc = preflightBook({
      ...base,
      book: { pages: [{ id: 'p', index: 0, templateId: 'blank', custom: true, slots: [{ slotId: 'photo-1', role: 'photo', assetId: 'a', frame: { x: 0, y: 0, w: 12 / 8.5, h: 1 } }] }, ...blank], updatedAt: '2026-09-14T10:00:00.000Z' },
    });
    expect(adHoc.items.find((i) => i.code === 'low-resolution')).toMatchObject({ level: 'error', slotId: 'photo-1' });
  });
});

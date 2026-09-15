import { FORMAT_PRESETS } from '@bookbinder/shared';
import { describe, expect, it } from 'vitest';
import { applyFaceCrops, coverCrop, effectivePpi, faceFocal, objectPosition } from './crop.js';
import { getTemplate } from './templates.js';
import {
  assignPhotos,
  BLANK_TEMPLATE_ID,
  chooseTemplate,
  COLOPHON_TEMPLATE_ID,
  DEFAULT_BODY_TEMPLATES,
  isOpenerTemplate,
  paginate,
  photoSlots,
  placedAssetIds,
  refitPage,
  reindexPages,
  templatesForPhotos,
  TITLE_TEMPLATE_ID,
  type PhotoInput,
} from './paginate.js';

const square = FORMAT_PRESETS['lulu-square-8.5']!;
const home = FORMAT_PRESETS['home-letter']!;

/** Deterministic pseudo-album: alternating landscapes, portraits and squares, one per minute. */
function album(n: number, seed = 7): PhotoInput[] {
  const ratios = [1.5, 0.667, 1, 1.333, 1.78, 0.75, 1.5, 1.5];
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    ratio: ratios[(i * seed) % ratios.length]!,
    takenAt: new Date(Date.UTC(2026, 4, 12, 9, i)).toISOString(),
  }));
}

let counter = 0;
const ids = () => `id-${counter++}`;

describe('assignPhotos / chooseTemplate', () => {
  it('puts portraits in portrait-leaning slots and landscapes in wide ones', () => {
    const t = getTemplate('three-up'); // hero 1.6/1.5 over two 1.333/1
    const photos: PhotoInput[] = [
      { id: 'sq', ratio: 1 },
      { id: 'wide', ratio: 1.6 },
      { id: 'mid', ratio: 1.3 },
    ];
    const { slots } = assignPhotos(t, photos);
    expect(slots.find((s) => s.slotId === 'p1')?.assetId).toBe('wide');
    expect(new Set(slots.map((s) => s.assetId))).toEqual(new Set(['sq', 'wide', 'mid']));
  });

  it('rejects a photo count that does not match the template', () => {
    expect(() => assignPhotos(getTemplate('two-up'), [{ id: 'x', ratio: 1 }])).toThrow(/holds 2 photos/);
  });

  it('prefers full bleed for a wide single photo and matted for a portrait', () => {
    const candidates = DEFAULT_BODY_TEMPLATES.map((id) => getTemplate(id));
    expect(chooseTemplate([{ id: 'w', ratio: 1.78 }], candidates)?.template.id).toBe('one-up-full-bleed');
    expect(chooseTemplate([{ id: 'p', ratio: 0.667 }], candidates)?.template.id).toBe('one-up-full-bleed');
    // 3:2 fits both; the variety penalty flips the choice when the previous page used full bleed.
    const first = chooseTemplate([{ id: 'l', ratio: 1.5 }], candidates)?.template.id;
    const next = chooseTemplate([{ id: 'l', ratio: 1.5 }], candidates, first)?.template.id;
    expect(next).not.toBe(first);
  });
});

describe('paginate', () => {
  it('places every photo exactly once, in order, and starts with a title page', () => {
    const photos = album(120);
    const { pages, warnings } = paginate(photos, { format: square, targetPages: 48, makeId: ids });
    expect(warnings).toEqual([]);
    expect(pages[0]!.templateId).toBe(TITLE_TEMPLATE_ID);
    const placed = placedAssetIds(pages);
    expect(placed).toHaveLength(photos.length);
    expect(new Set(placed).size).toBe(photos.length);
    // Chronology holds between pages: the last photo of a page precedes the first of the next.
    const order = new Map(photos.map((p, i) => [p.id, i]));
    let lastMax = -1;
    for (const p of pages.slice(1)) {
      const idx = p.slots.filter((s) => s.assetId).map((s) => order.get(s.assetId!)!);
      if (idx.length === 0) continue;
      expect(Math.min(...idx)).toBeGreaterThan(lastMax);
      lastMax = Math.max(...idx);
    }
  });

  it('lands near the target page count and obeys the format rules', () => {
    const { pages } = paginate(album(120), { format: square, targetPages: 48, makeId: ids });
    expect(pages.length % square.pageMultiple).toBe(0);
    expect(pages.length).toBeGreaterThanOrEqual(square.minPages);
    expect(Math.abs(pages.length - 48)).toBeLessThanOrEqual(4);
    for (const p of pages) expect(p.index).toBe(pages.indexOf(p));
  });

  it('closes the book with a colophon page after the body and before nothing else', () => {
    const { pages } = paginate(album(30), { format: square, targetPages: 24, makeId: ids });
    expect(pages[pages.length - 1]!.templateId).toBe(COLOPHON_TEMPLATE_ID);
    expect(pages.filter((p) => p.templateId === COLOPHON_TEMPLATE_ID)).toHaveLength(1);
    expect(pages.length % 2).toBe(0);
    const without = paginate(album(30), { format: square, targetPages: 24, colophon: false, makeId: ids });
    expect(without.pages.some((p) => p.templateId === COLOPHON_TEMPLATE_ID)).toBe(false);
  });

  it('pads a small album with blank pages up to the minimum', () => {
    const { pages } = paginate(album(6), { format: square, targetPages: 24, makeId: ids });
    expect(pages.length).toBe(24);
    expect(pages.filter((p) => p.templateId === BLANK_TEMPLATE_ID).length).toBeGreaterThan(0);
    // Six photos over 22 body pages: each gets its own page.
    const photoPages = pages.filter((p) => p.slots.some((s) => s.assetId));
    expect(photoPages).toHaveLength(6);
  });

  it('uses dense templates when far more photos than pages', () => {
    const { pages, warnings } = paginate(album(400), { format: square, targetPages: 24, makeId: ids });
    const counts = pages.map((p) => p.slots.filter((s) => s.assetId).length);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(4);
    expect(placedAssetIds(pages)).toHaveLength(400);
    expect(warnings.some((w) => /target/.test(w))).toBe(true);
  });

  it('respects a restricted template set and no title page', () => {
    const { pages } = paginate(album(10), { format: home, targetPages: 10, templateIds: ['two-up'], titlePage: false, colophon: false, makeId: ids });
    expect(pages.every((p) => p.templateId === 'two-up' || p.templateId === BLANK_TEMPLATE_ID)).toBe(true);
    expect(pages[0]!.templateId).toBe('two-up');
  });

  it('matches every slot id to the template it names', () => {
    const { pages } = paginate(album(60), { format: square, targetPages: 32, makeId: ids });
    for (const p of pages) {
      const t = getTemplate(p.templateId);
      const ids = new Set(photoSlots(t).map((s) => s.id));
      for (const s of p.slots) expect(ids.has(s.slotId), `${p.templateId}/${s.slotId}`).toBe(true);
      expect(p.slots.filter((s) => s.assetId).length).toBe(ids.size);
    }
  });
});

describe('editing helpers', () => {
  const ratios = new Map([
    ['a', 1.5],
    ['b', 0.667],
    ['c', 1],
  ]);

  it('refits a page to a template of the new photo count and keeps crops', () => {
    const page = { id: 'p', index: 3, templateId: 'two-up', slots: [{ slotId: 'p1', assetId: 'a', crop: { focalX: 0.2, focalY: 0.3, zoom: 1 } }, { slotId: 'p2', assetId: 'b' }] };
    const one = refitPage(page, ['a'], ratios);
    expect(photoSlots(getTemplate(one.templateId))).toHaveLength(1);
    expect(one.slots[0]).toMatchObject({ assetId: 'a', crop: { focalX: 0.2, focalY: 0.3 } });

    const three = refitPage(page, ['a', 'b', 'c'], ratios);
    expect(photoSlots(getTemplate(three.templateId))).toHaveLength(3);
    expect(placedAssetIds([three]).sort()).toEqual(['a', 'b', 'c']);

    const empty = refitPage(page, [], ratios);
    expect(empty.templateId).toBe(BLANK_TEMPLATE_ID);
  });

  it('keeps the current template when the count still fits and re-assigns for aspect', () => {
    const page = { id: 'p', index: 0, templateId: 'two-up', slots: [{ slotId: 'p1', assetId: 'a' }, { slotId: 'p2', assetId: 'b' }] };
    const swapped = refitPage(page, ['b', 'a'], ratios);
    expect(swapped.templateId).toBe('two-up');
    expect(placedAssetIds([swapped]).sort()).toEqual(['a', 'b']);
  });

  it('lists templates for a photo count sorted by fit', () => {
    const list = templatesForPhotos([{ id: 'x', ratio: 0.667 }]);
    expect(list.map((l) => l.template.id)).toEqual(['one-up-full-bleed', 'one-up-matted']);
    expect(templatesForPhotos([{ id: 'x', ratio: 1 }, { id: 'y', ratio: 1 }, { id: 'z', ratio: 1 }, { id: 'w', ratio: 1 }]).map((l) => l.template.id)).toEqual(['four-up-grid', 'hero-strip']);
  });

  it('reindexes pages after reordering', () => {
    const pages = reindexPages([
      { id: 'b', index: 1, templateId: BLANK_TEMPLATE_ID, slots: [] },
      { id: 'a', index: 0, templateId: BLANK_TEMPLATE_ID, slots: [] },
    ]);
    expect(pages.map((p) => [p.id, p.index])).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
  });
});

describe('crop math', () => {
  it('cover-fits a landscape into a square, centred by default', () => {
    const r = coverCrop(3000, 2000, 1000, 1000);
    expect(r).toEqual({ x: 500, y: 0, w: 2000, h: 2000 });
  });

  it('follows the focal point like CSS object-position', () => {
    expect(coverCrop(3000, 2000, 1000, 1000, { focalX: 0, focalY: 0.5 })).toEqual({ x: 0, y: 0, w: 2000, h: 2000 });
    expect(coverCrop(3000, 2000, 1000, 1000, { focalX: 1, focalY: 0.5 })).toEqual({ x: 1000, y: 0, w: 2000, h: 2000 });
    expect(objectPosition({ focalX: 0.25, focalY: 0.75 })).toBe('25.00% 75.00%');
  });

  it('zooms around the focal point and clamps to the source', () => {
    const r = coverCrop(3000, 2000, 1000, 1000, { focalX: 0.9, focalY: 0.9, zoom: 2 });
    expect(r.w).toBe(1000);
    expect(r.h).toBe(1000);
    expect(r.x + r.w).toBeLessThanOrEqual(3000);
    expect(r.y + r.h).toBeLessThanOrEqual(2000);
  });

  it('reports effective ppi for a slot', () => {
    // 6000 px wide over 8.75 in => 685 ppi limited by the taller dimension: 4000 px over 8.75 in => 457.
    expect(Math.round(effectivePpi(6000, 4000, 8.75, 8.75))).toBe(457);
    expect(Math.round(effectivePpi(1440, 960, 8.75, 8.75))).toBe(110);
  });
});

describe('chapters', () => {
  const chaptered = (): { photos: PhotoInput[]; chapters: Array<{ id: string; title: string; subtitle: string }> } => {
    const photos = album(90).map((p, i) => ({ ...p, score: ((i * 37) % 100) / 100, chapterId: i < 40 ? 'ch1' : i < 55 ? 'ch2' : 'ch3' }));
    return {
      photos,
      chapters: [
        { id: 'ch1', title: 'Lisbon', subtitle: 'May 12 – 13, 2026' },
        { id: 'ch2', title: 'Sintra', subtitle: 'May 14, 2026' },
        { id: 'ch3', title: 'Porto', subtitle: 'May 15 – 16, 2026' },
      ],
    };
  };

  it('opens every chapter on a verso photo page facing a recto title page', () => {
    const { photos, chapters } = chaptered();
    const result = paginate(photos, { format: square, targetPages: 48, chapters, makeId: ids });
    expect(result.chapters.map((c) => c.title)).toEqual(['Lisbon', 'Sintra', 'Porto']);
    for (const ch of result.chapters) {
      const opener = result.pages[ch.startsAtPage]!;
      const title = result.pages[ch.startsAtPage + 1]!;
      expect(opener.templateId).toBe('chapter-photo');
      expect(opener.index % 2).toBe(1);
      expect(title.templateId).toBe('chapter-title');
      expect(opener.chapterId).toBe(ch.id);
      expect(title.chapterId).toBe(ch.id);
      expect(opener.slots[0]!.assetId).toBeDefined();
    }
    // Every photo placed once; the hero of each chapter is a high scorer from that chapter.
    const placed = placedAssetIds(result.pages);
    expect(placed).toHaveLength(photos.length);
    expect(new Set(placed).size).toBe(photos.length);
    const byId = new Map(photos.map((p) => [p.id, p]));
    const heroLisbon = byId.get(result.pages[result.chapters[0]!.startsAtPage]!.slots[0]!.assetId!)!;
    expect(heroLisbon.chapterId).toBe('ch1');
    expect(heroLisbon.score).toBeGreaterThan(0.8);
    // Body pages carry their chapter; the page count still lands near the target.
    expect(result.pages.filter((p) => p.chapterId === 'ch2' && p.slots.some((s) => s.assetId)).length).toBeGreaterThan(1);
    expect(Math.abs(result.pages.length - 48)).toBeLessThanOrEqual(6);
    expect(isOpenerTemplate('chapter-title')).toBe(true);
    expect(isOpenerTemplate('two-up')).toBe(false);
  });

  it('ignores chapter ids that are not in the plan and works without chapters as before', () => {
    const { photos } = chaptered();
    const plain = paginate(photos, { format: square, targetPages: 48, makeId: ids });
    expect(plain.chapters).toEqual([]);
    expect(plain.pages.some((p) => p.templateId === 'chapter-photo')).toBe(false);
    expect(placedAssetIds(plain.pages)).toHaveLength(photos.length);
  });

  it('gives a one-photo chapter just its opener', () => {
    const photos: PhotoInput[] = [
      { id: 'a', ratio: 1.5, chapterId: 'x' },
      { id: 'b', ratio: 1, chapterId: 'y' },
      { id: 'c', ratio: 1, chapterId: 'y' },
    ];
    const result = paginate(photos, { format: home, targetPages: 8, chapters: [{ id: 'x', title: 'X' }, { id: 'y', title: 'Y' }], makeId: ids });
    expect(result.chapters).toHaveLength(2);
    expect(result.pages.filter((p) => p.templateId === 'chapter-photo')).toHaveLength(2);
    expect(placedAssetIds(result.pages).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('face-aware crops', () => {
  it('centres the visible window on the faces and clamps at the edges', () => {
    // Landscape 3:2 into a square slot: a third of the width is cut. Face at the far left.
    const left = faceFocal([{ x: 0.05, y: 0.3, w: 0.1, h: 0.15 }], 1.5, 1);
    expect(left).toEqual({ focalX: 0, focalY: 0.5, zoom: 1 });
    const right = faceFocal([{ x: 0.85, y: 0.3, w: 0.1, h: 0.15 }], 1.5, 1);
    expect(right?.focalX).toBe(1);
    // A face slightly right of centre pulls the window right without hitting the clamp.
    const mid = faceFocal([{ x: 0.6, y: 0.3, w: 0.1, h: 0.15 }], 1.5, 1);
    expect(mid!.focalX).toBeGreaterThan(0.5);
    expect(mid!.focalX).toBeLessThan(1);
    expect(mid!.focalY).toBe(0.5);
    // Portrait into a wide slot: the vertical axis is cut; a face near the top keeps the top.
    const top = faceFocal([{ x: 0.4, y: 0.05, w: 0.2, h: 0.15 }], 0.667, 1.5);
    expect(top).toEqual({ focalX: 0.5, focalY: 0, zoom: 1 });
    // Nothing to do when the ratios match or there are no faces.
    expect(faceFocal([{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }], 1.5, 1.5)).toBeUndefined();
    expect(faceFocal([], 1.5, 1)).toBeUndefined();
  });

  it('applies crops to placed photos with faces and leaves existing crops alone', () => {
    const pages = [
      { id: 'p', index: 1, templateId: 'four-up-grid', slots: [{ slotId: 'p1', assetId: 'a' }, { slotId: 'p2', assetId: 'b', crop: { focalX: 0.1, focalY: 0.1, zoom: 1 } }, { slotId: 'p3', assetId: 'c' }, { slotId: 'p4', assetId: 'd' }] },
    ];
    const faces = new Map([
      ['a', [{ x: 0.85, y: 0.4, w: 0.1, h: 0.1 }]],
      ['b', [{ x: 0.85, y: 0.4, w: 0.1, h: 0.1 }]],
      ['c', [{ x: 0.85, y: 0.4, w: 0.1, h: 0.1 }]],
    ]);
    const ratios = new Map([
      ['a', 1.5],
      ['b', 1.5],
      ['c', 1],
      ['d', 1.5],
    ]);
    const out = applyFaceCrops(pages, square, faces, ratios);
    const slot = (id: string) => out[0]!.slots.find((s) => s.slotId === id)!;
    expect(slot('p1').crop?.focalX).toBe(1);
    expect(slot('p2').crop).toEqual({ focalX: 0.1, focalY: 0.1, zoom: 1 });
    expect(slot('p3').crop).toBeUndefined(); // square photo in a square slot: nothing cut
    expect(slot('p4').crop).toBeUndefined(); // no faces
  });
});

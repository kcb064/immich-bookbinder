import { describe, expect, it } from 'vitest';
import { FORMAT_PRESETS } from '@bookbinder/shared';
import { TEMPLATES, getTemplate, normalizePageCount, pageTemplatesForCount, slotToPx } from './index.js';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
  a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

describe('template library', () => {
  it('has unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares photoCount matching hero/photo slots (except variable-count)', () => {
    for (const t of TEMPLATES) {
      if (t.tags.includes('variable-count')) continue;
      const photos = t.slots.filter((s) => s.role === 'hero' || s.role === 'photo').length;
      expect(photos, t.id).toBe(t.photoCount);
    }
  });

  it('keeps every slot inside the bleed box of its page(s)', () => {
    const bleed = 12 / 816 + 1e-4;
    for (const t of TEMPLATES) {
      const minX = t.kind === 'cover' ? -1 - bleed : -bleed;
      const maxX = t.kind === 'page' ? 1 + bleed : t.kind === 'spread' ? 2 + bleed : 1 + bleed;
      for (const s of t.slots) {
        expect(s.x, `${t.id}/${s.id} x`).toBeGreaterThanOrEqual(minX);
        expect(s.y, `${t.id}/${s.id} y`).toBeGreaterThanOrEqual(-bleed);
        expect(s.x + s.w, `${t.id}/${s.id} right`).toBeLessThanOrEqual(maxX);
        expect(s.y + s.h, `${t.id}/${s.id} bottom`).toBeLessThanOrEqual(1 + bleed);
      }
    }
  });

  it('never overlaps two photo slots', () => {
    for (const t of TEMPLATES) {
      const photos = t.slots.filter((s) => s.role === 'hero' || s.role === 'photo');
      for (let i = 0; i < photos.length; i++)
        for (let j = i + 1; j < photos.length; j++)
          expect(overlaps(photos[i]!, photos[j]!), `${t.id}: ${photos[i]!.id} vs ${photos[j]!.id}`).toBe(false);
    }
  });

  it('only panorama and cover cross the gutter', () => {
    for (const t of TEMPLATES) {
      const crosses = t.slots.some((s) => s.x < 1 && s.x + s.w > 1 + 1e-6 && t.kind !== 'page');
      if (t.kind === 'cover') continue;
      expect(crosses, t.id).toBe(t.crossesGutter);
    }
  });

  it('finds page templates by photo count', () => {
    expect(pageTemplatesForCount(1).map((t) => t.id)).toEqual(['one-up-full-bleed', 'one-up-matted', 'text-photo']);
    expect(pageTemplatesForCount(4).length).toBe(2);
    expect(getTemplate('chapter-opener').kind).toBe('spread');
  });
});

describe('geometry helpers', () => {
  const fmt = FORMAT_PRESETS['lulu-square-8.5']!;

  it('converts a full-bleed slot to the full page at 300 ppi', () => {
    const t = getTemplate('one-up-full-bleed');
    const r = slotToPx(t.slots[0]!, fmt, 300);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBe(Math.round(8.75 * 300));
    expect(r.h).toBe(Math.round(8.75 * 300));
  });

  it('places the right page of a spread at its own origin', () => {
    const t = getTemplate('chapter-opener');
    const title = t.slots.find((s) => s.id === 'title')!;
    const r = slotToPx(title, fmt, 96, 1);
    expect(r.x).toBe(56 + 12);
    expect(r.y).toBe(96 + 12);
  });

  it('normalizes page counts to Lulu casewrap rules', () => {
    expect(normalizePageCount(10, fmt)).toBe(24);
    expect(normalizePageCount(47, fmt)).toBe(48);
    expect(normalizePageCount(48, fmt)).toBe(48);
    expect(normalizePageCount(5000, fmt)).toBe(800);
    expect(normalizePageCount(3, FORMAT_PRESETS['home-letter']!)).toBe(3);
  });
});

import { FORMAT_PRESETS, type CoverGeometry } from '@bookbinder/shared';
import { describe, expect, it } from 'vitest';
import { angleFromCentre, clampToBounds, coverSnapLines, pageSnapLines, resizeBy, slotSnapLines, snapAngle, snapMove, snapResize } from './snap.js';

const square = FORMAT_PRESETS['lulu-square-8.5']!;
const home = FORMAT_PRESETS['home-letter']!;

describe('snap lines', () => {
  it('lists trim, bleed, safety (gutter on the spine side) and centre guides of a page', () => {
    const recto = pageSnapLines(square, 'right');
    const at = (kind: string, axis: 'x' | 'y') => recto.filter((l) => l.kind === kind && l.axis === axis).map((l) => l.at);
    expect(at('trim', 'x')).toEqual([0, 8.5]);
    expect(at('bleed', 'y')).toEqual([-0.125, 8.625]);
    // Recto: spine on the left, so the gutter safety (0.5 = max(0.5, 0.375)) applies there.
    expect(at('safety', 'x')).toEqual([0.5, 8]);
    expect(at('centre', 'x')).toEqual([4.25]);
    const wide = { ...square, gutterSafetyIn: 0.75 };
    expect(pageSnapLines(wide, 'right').filter((l) => l.kind === 'safety' && l.axis === 'x').map((l) => l.at)).toEqual([0.75, 8]);
    expect(pageSnapLines(wide, 'left').filter((l) => l.kind === 'safety' && l.axis === 'x').map((l) => l.at)).toEqual([0.5, 7.75]);
    // Home prints have no bleed and therefore no bleed guides.
    expect(pageSnapLines(home, 'left').some((l) => l.kind === 'bleed')).toBe(false);
  });

  it('lists both cover panels and the spine edges', () => {
    const g: CoverGeometry = { widthIn: 18.8, heightIn: 10, spineIn: 0.3, wrapIn: 0.75, frontLeftIn: 9.55, source: 'estimate' };
    const lines = coverSnapLines(square, g);
    const xs = (kind: string) => lines.filter((l) => l.kind === kind && l.axis === 'x').map((l) => l.at);
    expect(xs('trim')).toEqual([0.75, 9.25, 9.55, 18.05]);
    expect(xs('spine')).toEqual([9.25, 9.55]);
    expect(xs('centre')).toEqual([5, 13.8]);
    expect(lines.filter((l) => l.axis === 'y' && l.kind === 'trim').map((l) => l.at)).toEqual([0.75, 9.25]);
  });

  it('adds edges and centres of other slots', () => {
    const lines = slotSnapLines([{ x: 1, y: 2, w: 2, h: 4 }]);
    expect(lines.filter((l) => l.axis === 'x').map((l) => l.at)).toEqual([1, 2, 3]);
    expect(lines.filter((l) => l.axis === 'y').map((l) => l.at)).toEqual([2, 4, 6]);
  });
});

describe('snapping', () => {
  const guides = pageSnapLines(square, 'right');

  it('moves a box onto the nearest guide per axis within the threshold and reports the hits', () => {
    const r = snapMove({ x: 0.55, y: 3, w: 2, h: 2 }, guides, 0.1);
    expect(r.rect.x).toBe(0.5);
    expect(r.rect.y).toBe(3);
    expect(r.hits).toEqual([{ axis: 'x', at: 0.5, kind: 'safety' }]);
    // The centre snaps too: a 2 in box centred at 4.2 lands on the 4.25 page centre.
    const c = snapMove({ x: 3.2, y: 3.2, w: 2, h: 2 }, guides, 0.1);
    expect(c.rect).toEqual({ x: 3.25, y: 3.25, w: 2, h: 2 });
    expect(c.hits.map((h) => h.kind)).toEqual(['centre', 'centre']);
    // Out of reach: unchanged.
    expect(snapMove({ x: 1, y: 1, w: 2, h: 2 }, guides, 0.1)).toEqual({ rect: { x: 1, y: 1, w: 2, h: 2 }, hits: [] });
  });

  it('resizes only the dragged edges onto guides and never below the minimum size', () => {
    const r = snapResize({ x: 1, y: 1, w: 2, h: 6.95 }, { right: true, bottom: true }, guides, 0.1);
    expect(r.rect).toEqual({ x: 1, y: 1, w: 2, h: 7 });
    expect(r.hits).toEqual([{ axis: 'y', at: 8, kind: 'safety' }]);
    const l = snapResize({ x: 0.45, y: 1, w: 2, h: 2 }, { left: true }, guides, 0.1);
    expect(l.rect).toEqual({ x: 0.5, y: 1, w: 1.95, h: 2 });
    const tiny = snapResize({ x: 0.45, y: 1, w: 0.2, h: 2 }, { left: true }, guides, 0.1);
    expect(tiny.rect.w).toBe(0.2);
    expect(tiny.hits).toEqual([]);
  });

  it('resizes by a delta, keeping the aspect when asked and anchoring the far edge', () => {
    expect(resizeBy({ x: 1, y: 1, w: 2, h: 2 }, { right: true }, 1, 0, undefined)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
    expect(resizeBy({ x: 1, y: 1, w: 2, h: 2 }, { left: true, top: true }, -1, -1, undefined)).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    // Dragging the top edge past the bottom stops at the minimum height, anchored on the bottom.
    expect(resizeBy({ x: 1, y: 1, w: 2, h: 2 }, { top: true }, 0, 5, undefined)).toEqual({ x: 1, y: 2.75, w: 2, h: 0.25 });
    // Locked 2:1 aspect from a corner follows the dominant axis.
    expect(resizeBy({ x: 1, y: 1, w: 2, h: 1 }, { right: true, bottom: true }, 2, 0.1, 2)).toEqual({ x: 1, y: 1, w: 4, h: 2 });
    // Locked from one edge: the other dimension follows and stays centred.
    expect(resizeBy({ x: 1, y: 1, w: 2, h: 1 }, { right: true }, 2, 0, 2)).toEqual({ x: 1, y: 0.5, w: 4, h: 2 });
    // Never below the minimum.
    expect(resizeBy({ x: 1, y: 1, w: 2, h: 2 }, { right: true }, -5, 0, undefined).w).toBe(0.25);
    expect(resizeBy({ x: 1, y: 1, w: 2, h: 1 }, { right: true }, -5, 0, 2)).toEqual({ x: 1, y: 1.375, w: 0.5, h: 0.25 });
  });

  it('keeps a quarter inch of every box inside the bleed box', () => {
    const bounds = { x: -0.125, y: -0.125, w: 8.75, h: 8.75 };
    expect(clampToBounds({ x: -5, y: 2, w: 2, h: 2 }, bounds)).toEqual({ x: -1.875, y: 2, w: 2, h: 2 });
    expect(clampToBounds({ x: 20, y: 20, w: 2, h: 2 }, bounds)).toEqual({ x: 8.375, y: 8.375, w: 2, h: 2 });
    expect(clampToBounds({ x: 1, y: 1, w: 2, h: 2 }, bounds)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    // A box smaller than the margin must stay entirely inside.
    expect(clampToBounds({ x: 9, y: 0, w: 0.1, h: 0.1 }, bounds).x).toBeCloseTo(8.525, 6);
  });

  it('snaps angles to 15 degree steps within 3 degrees and normalises the range', () => {
    expect(snapAngle(13.5)).toBe(15);
    expect(snapAngle(11)).toBe(11);
    expect(snapAngle(-1.4)).toBe(0);
    expect(snapAngle(361)).toBe(0);
    expect(snapAngle(190)).toBe(-170);
    expect(snapAngle(180)).toBe(180);
    expect(angleFromCentre({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(0);
    expect(angleFromCentre({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(90);
    expect(angleFromCentre({ x: 0, y: 0 }, { x: -1, y: 0 })).toBe(-90);
  });
});

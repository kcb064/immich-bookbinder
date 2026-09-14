import type { BookFormat, SlotSpec } from '@bookbinder/shared';
import { PX_PER_IN } from '@bookbinder/shared';

export { TEMPLATES, getTemplate, pageTemplatesForCount } from './templates.js';
export * from './paginate.js';
export * from './crop.js';

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Converts a slot (fractions of one page's trim) to pixels on a rendered page whose origin is
 * the top-left of the BLEED box. `ppi` defaults to 96 for screen; use 300 for print.
 * For spreads/covers pass `pageOffset` (0 for the left/back page, 1 for the right/front page)
 * and the renderer places each page's canvas separately.
 */
export function slotToPx(slot: SlotSpec, format: BookFormat, ppi = PX_PER_IN, pageOffset = 0): PxRect {
  const trimW = format.trimWidthIn * ppi;
  const trimH = format.trimHeightIn * ppi;
  const bleed = format.bleedIn * ppi;
  return {
    x: Math.round((slot.x - pageOffset) * trimW + bleed),
    y: Math.round(slot.y * trimH + bleed),
    w: Math.round(slot.w * trimW),
    h: Math.round(slot.h * trimH),
  };
}

/** Pixel dimensions of one page including bleed at the given ppi. */
export function pagePx(format: BookFormat, ppi = PX_PER_IN): { w: number; h: number } {
  return {
    w: Math.round((format.trimWidthIn + 2 * format.bleedIn) * ppi),
    h: Math.round((format.trimHeightIn + 2 * format.bleedIn) * ppi),
  };
}

/** Rounds a page count up to the format's rules (multiple, min, max). */
export function normalizePageCount(requested: number, format: BookFormat): number {
  const m = format.pageMultiple;
  let n = Math.max(format.minPages, Math.ceil(requested / m) * m);
  n = Math.min(n, format.maxPages);
  return n;
}

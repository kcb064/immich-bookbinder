import type { BookFormat, CoverGeometry, LuluBinding, LuluPaper, LuluProduct } from '@bookbinder/shared';

/**
 * Sheet thickness per interior page, inches. ESTIMATE, verified against Lulu /cover-dimensions/ in M5:
 * Lulu publishes 444 ppi (pages per inch) figures per paper; these are their reciprocals.
 */
export const PAPER_CALIPER_IN: Record<LuluPaper, number> = {
  '080CW444': 0.002252, // 80# coated white
  '060UW444': 0.0025, // 60# uncoated white
  '060UC444': 0.0025, // 60# uncoated cream
};

/** Bindings whose cover wraps around board (hardcovers); the rest are soft covers. */
const HARDCOVER: ReadonlySet<LuluBinding> = new Set(['CW', 'LW']);

/** ESTIMATE, verified against Lulu /cover-dimensions/ in M5: board and hinge allowance added to a hardcover spine. */
export const HARDCOVER_BOARD_IN = 0.25;
/** ESTIMATE, verified against Lulu /cover-dimensions/ in M5: paper folded around the boards of a hardcover. */
export const HARDCOVER_WRAP_IN = 0.75;

/** Below this the spine is too thin for text; the renderer leaves it blank. */
export const MIN_SPINE_TEXT_IN = 0.25;

/**
 * Real sheet size from Lulu's /cover-dimensions/, in inches (the client converts its `pt` answer).
 * Lulu answers only width and height, so the wrap is derived from the height (`(height - trim) / 2`)
 * and the spine from the width; pass `spineIn` to skip that derivation.
 */
export interface CoverOverride {
  widthIn: number;
  heightIn: number;
  spineIn?: number;
}

/**
 * Size of the one-page cover PDF: back cover, spine and front cover side by side, plus the wrap
 * (hardcover) or bleed (softcover) on every outer edge. Without `override` the spine is an
 * ESTIMATE from the paper caliper and page count; with one (Lulu's /cover-dimensions/ answer, M5)
 * the sheet is exactly what Lulu expects.
 */
export function coverGeometry(format: BookFormat, product: LuluProduct, pageCount: number, override?: CoverOverride): CoverGeometry {
  const trimW = format.trimWidthIn;
  if (override) {
    const wrapIn = override.spineIn === undefined ? Math.max(0, (override.heightIn - format.trimHeightIn) / 2) : Math.max(0, (override.widthIn - 2 * trimW - override.spineIn) / 2);
    const spineIn = override.spineIn ?? Math.max(0, override.widthIn - 2 * trimW - 2 * wrapIn);
    return {
      widthIn: round4(override.widthIn),
      heightIn: round4(override.heightIn),
      spineIn: round4(spineIn),
      wrapIn: round4(wrapIn),
      frontLeftIn: round4(wrapIn + trimW + spineIn),
      source: 'lulu',
    };
  }
  const hard = HARDCOVER.has(product.binding);
  const spineIn = round4(Math.max(0, pageCount) * PAPER_CALIPER_IN[product.paper] + (hard ? HARDCOVER_BOARD_IN : 0));
  const wrapIn = hard ? HARDCOVER_WRAP_IN : format.bleedIn;
  return {
    widthIn: round4(2 * wrapIn + 2 * trimW + spineIn),
    heightIn: round4(2 * wrapIn + format.trimHeightIn),
    spineIn,
    wrapIn,
    frontLeftIn: round4(wrapIn + trimW + spineIn),
    source: 'estimate',
  };
}

/**
 * Box of a cover slot on the sheet, in inches from the sheet's top-left: back cover on the left,
 * the spine, then the front; template x runs -1..0 (back) and 0..1 (front), bleed slots reach the
 * sheet edge, and the `spine` slot is the spine itself.
 */
export function coverSlotIn(slot: { id: string; x: number; y: number; w: number; h: number }, format: BookFormat, g: CoverGeometry): { x: number; y: number; w: number; h: number } {
  const trimW = format.trimWidthIn;
  const trimH = format.trimHeightIn;
  const eps = 1e-6;
  const mapX = (u: number): number => {
    if (u <= -1 - eps) return 0;
    if (u >= 1 + eps) return g.widthIn;
    return u <= 0 ? g.wrapIn + (u + 1) * trimW : g.wrapIn + trimW + g.spineIn + u * trimW;
  };
  const mapY = (v: number): number => (v <= -eps ? 0 : v >= 1 + eps ? g.heightIn : g.wrapIn + v * trimH);
  if (slot.id === 'spine') return { x: g.wrapIn + trimW, y: g.wrapIn, w: g.spineIn, h: trimH };
  const x0 = mapX(slot.x);
  const x1 = mapX(slot.x + slot.w);
  const y0 = mapY(slot.y);
  const y1 = mapY(slot.y + slot.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

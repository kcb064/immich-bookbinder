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

/** Real dimensions from Lulu, in inches (M5 converts its `pt` answer). */
export interface CoverOverride {
  widthIn: number;
  heightIn: number;
  spineIn: number;
}

/**
 * Size of the one-page cover PDF: back cover, spine and front cover side by side, plus the wrap
 * (hardcover) or bleed (softcover) on every outer edge. Without `override` the spine is an
 * ESTIMATE from the paper caliper and page count (verified against Lulu /cover-dimensions/ in M5).
 */
export function coverGeometry(format: BookFormat, product: LuluProduct, pageCount: number, override?: CoverOverride): CoverGeometry {
  const trimW = format.trimWidthIn;
  if (override) {
    const wrapIn = Math.max(0, (override.widthIn - 2 * trimW - override.spineIn) / 2);
    return {
      widthIn: override.widthIn,
      heightIn: override.heightIn,
      spineIn: override.spineIn,
      wrapIn: round4(wrapIn),
      frontLeftIn: round4(wrapIn + trimW + override.spineIn),
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

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

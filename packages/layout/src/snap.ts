import type { BookFormat, CoverGeometry } from '@bookbinder/shared';

/**
 * Snapping and placement constraints for the designer (M6). Everything is in one linear unit
 * (inches in practice) with an explicit origin; the editor converts pixels and frames itself.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SnapKind = 'trim' | 'bleed' | 'safety' | 'centre' | 'spine' | 'slot';

/** A vertical (`axis: 'x'`) or horizontal (`axis: 'y'`) guide at `at`. */
export interface SnapLine {
  axis: 'x' | 'y';
  at: number;
  kind: SnapKind;
}

/** Minimum size of a box while resizing, and how much of it must stay inside the bleed box. */
export const MIN_BOX_IN = 0.25;
export const MIN_INSIDE_IN = 0.25;

/** Rotation snaps to multiples of this many degrees when within `SNAP_ANGLE_WITHIN`. */
export const SNAP_ANGLE_STEP = 15;
export const SNAP_ANGLE_WITHIN = 3;

function lines(axis: 'x' | 'y', kind: SnapKind, ...ats: number[]): SnapLine[] {
  return ats.map((at) => ({ axis, at, kind }));
}

/**
 * Guides of one page in inches from the top-left of the TRIM box: trim edges, bleed edges, the
 * safety band (gutter safety on the spine side: recto pages have the spine on their left) and
 * the page centre.
 */
export function pageSnapLines(format: BookFormat, side: 'left' | 'right'): SnapLine[] {
  const w = format.trimWidthIn;
  const h = format.trimHeightIn;
  const b = format.bleedIn;
  const outer = format.safetyIn;
  const inner = Math.max(format.safetyIn, format.gutterSafetyIn);
  const left = side === 'right' ? inner : outer;
  const right = side === 'right' ? outer : inner;
  return [
    ...lines('x', 'trim', 0, w),
    ...lines('y', 'trim', 0, h),
    ...(b > 0 ? [...lines('x', 'bleed', -b, w + b), ...lines('y', 'bleed', -b, h + b)] : []),
    ...lines('x', 'safety', left, w - right),
    ...lines('y', 'safety', outer, h - outer),
    ...lines('x', 'centre', w / 2),
    ...lines('y', 'centre', h / 2),
  ];
}

/**
 * Guides of the cover sheet in inches from the top-left of the SHEET: each panel's trim edges,
 * safety band and centre, the sheet edges and the two spine edges.
 */
export function coverSnapLines(format: BookFormat, g: CoverGeometry): SnapLine[] {
  const w = format.trimWidthIn;
  const h = format.trimHeightIn;
  const s = format.safetyIn;
  const backLeft = g.wrapIn;
  const frontLeft = g.frontLeftIn;
  const top = g.wrapIn;
  const out: SnapLine[] = [...lines('x', 'bleed', 0, g.widthIn), ...lines('y', 'bleed', 0, g.heightIn)];
  for (const left of [backLeft, frontLeft]) {
    out.push(...lines('x', 'trim', left, left + w), ...lines('x', 'safety', left + s, left + w - s), ...lines('x', 'centre', left + w / 2));
  }
  out.push(...lines('y', 'trim', top, top + h), ...lines('y', 'safety', top + s, top + h - s), ...lines('y', 'centre', top + h / 2));
  if (g.spineIn > 0) out.push(...lines('x', 'spine', backLeft + w, backLeft + w + g.spineIn));
  return out;
}

/** Edges and centres of other boxes on the page, so slots align with each other. */
export function slotSnapLines(rects: readonly Rect[]): SnapLine[] {
  const out: SnapLine[] = [];
  for (const r of rects) {
    out.push(...lines('x', 'slot', r.x, r.x + r.w / 2, r.x + r.w), ...lines('y', 'slot', r.y, r.y + r.h / 2, r.y + r.h));
  }
  return out;
}

export interface SnapResult {
  rect: Rect;
  /** The guides the box landed on (at most one per axis). */
  hits: SnapLine[];
}

/** Which edges a resize handle moves. */
export interface Edges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

function nearest(candidates: readonly number[], axisLines: readonly SnapLine[], threshold: number): { delta: number; line: SnapLine } | undefined {
  let best: { delta: number; line: SnapLine } | undefined;
  for (const c of candidates) {
    for (const line of axisLines) {
      const delta = line.at - c;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
    }
  }
  return best;
}

/**
 * Moves a box so that its nearest edge or centre lands on a guide, per axis, when one is within
 * `threshold`. The size is unchanged.
 */
export function snapMove(rect: Rect, guides: readonly SnapLine[], threshold: number): SnapResult {
  const xs = guides.filter((l) => l.axis === 'x');
  const ys = guides.filter((l) => l.axis === 'y');
  const hx = nearest([rect.x, rect.x + rect.w / 2, rect.x + rect.w], xs, threshold);
  const hy = nearest([rect.y, rect.y + rect.h / 2, rect.y + rect.h], ys, threshold);
  return {
    rect: { ...rect, x: rect.x + (hx?.delta ?? 0), y: rect.y + (hy?.delta ?? 0) },
    hits: [hx?.line, hy?.line].filter((l): l is SnapLine => Boolean(l)),
  };
}

/**
 * Snaps the edges a resize handle drags onto nearby guides; the opposite edges stay put. The box
 * never shrinks below `minSize`. Aspect locking is the caller's job (see {@link resizeBy}).
 */
export function snapResize(rect: Rect, edges: Edges, guides: readonly SnapLine[], threshold: number, minSize = MIN_BOX_IN): SnapResult {
  const xs = guides.filter((l) => l.axis === 'x');
  const ys = guides.filter((l) => l.axis === 'y');
  let { x, y, w, h } = rect;
  const hits: SnapLine[] = [];
  if (edges.left) {
    const hit = nearest([x], xs, threshold);
    if (hit && w - hit.delta >= minSize) {
      x += hit.delta;
      w -= hit.delta;
      hits.push(hit.line);
    }
  } else if (edges.right) {
    const hit = nearest([x + w], xs, threshold);
    if (hit && w + hit.delta >= minSize) {
      w += hit.delta;
      hits.push(hit.line);
    }
  }
  if (edges.top) {
    const hit = nearest([y], ys, threshold);
    if (hit && h - hit.delta >= minSize) {
      y += hit.delta;
      h -= hit.delta;
      hits.push(hit.line);
    }
  } else if (edges.bottom) {
    const hit = nearest([y + h], ys, threshold);
    if (hit && h + hit.delta >= minSize) {
      h += hit.delta;
      hits.push(hit.line);
    }
  }
  return { rect: { x, y, w, h }, hits };
}

/**
 * Resizes `rect` by dragging the given edges by (dx, dy), keeping the size at or above `minSize`;
 * with `ratio` (w/h) the box keeps that aspect, growing along the dominant drag axis and anchored on
 * the opposite corner or edge.
 */
export function resizeBy(rect: Rect, edges: Edges, dx: number, dy: number, ratio: number | undefined, minSize = MIN_BOX_IN): Rect {
  let { x, y, w, h } = rect;
  const right = x + w;
  const bottom = y + h;
  if (edges.left) w = Math.max(minSize, w - dx);
  if (edges.right) w = Math.max(minSize, w + dx);
  if (edges.top) h = Math.max(minSize, h - dy);
  if (edges.bottom) h = Math.max(minSize, h + dy);
  if (ratio) {
    const horizontal = edges.left || edges.right;
    const vertical = edges.top || edges.bottom;
    if (horizontal && vertical) {
      // Corner: follow whichever axis moved more.
      if (Math.abs(dx) >= Math.abs(dy)) h = w / ratio;
      else w = h * ratio;
    } else if (horizontal) h = w / ratio;
    else w = h * ratio;
    if (w < minSize) {
      w = minSize;
      h = w / ratio;
    }
    if (h < minSize) {
      h = minSize;
      w = h * ratio;
    }
  }
  if (edges.left) x = right - w;
  if (edges.top) y = bottom - h;
  if (!edges.left && !edges.right && ratio && (edges.top || edges.bottom)) x = rect.x + (rect.w - w) / 2;
  if (!edges.top && !edges.bottom && ratio && (edges.left || edges.right)) y = rect.y + (rect.h - h) / 2;
  return { x, y, w, h };
}

/**
 * Keeps at least `minInside` of the box inside `bounds` (the bleed box) on both axes, so nothing
 * can be dropped fully off the page. Boxes larger than the bounds are left where they are.
 */
export function clampToBounds(rect: Rect, bounds: Rect, minInside = MIN_INSIDE_IN): Rect {
  const keepX = Math.min(minInside, rect.w);
  const keepY = Math.min(minInside, rect.h);
  const x = Math.min(Math.max(rect.x, bounds.x - rect.w + keepX), bounds.x + bounds.w - keepX);
  const y = Math.min(Math.max(rect.y, bounds.y - rect.h + keepY), bounds.y + bounds.h - keepY);
  return { ...rect, x, y };
}

/** Snaps an angle to the nearest multiple of `step` when within `within` degrees; normalises to (-180, 180]. */
export function snapAngle(deg: number, step = SNAP_ANGLE_STEP, within = SNAP_ANGLE_WITHIN): number {
  let a = ((((deg + 180) % 360) + 360) % 360) - 180;
  const m = Math.round(a / step) * step;
  if (Math.abs(a - m) <= within) a = m;
  if (a <= -180) a += 360;
  return Math.round(a * 10) / 10 || 0;
}

/** Angle in degrees of the vector from `centre` to `point`, measured from "up" and clockwise (a rotation handle above the box reads 0). */
export function angleFromCentre(centre: { x: number; y: number }, point: { x: number; y: number }): number {
  return (Math.atan2(point.x - centre.x, -(point.y - centre.y)) * 180) / Math.PI;
}

/** Nudge distances: an arrow key moves a tenth of an inch, with Shift half an inch. */
export const NUDGE_IN = 0.1;
export const NUDGE_SHIFT_IN = 0.5;

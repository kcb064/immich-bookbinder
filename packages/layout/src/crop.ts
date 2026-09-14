import type { Crop } from '@bookbinder/shared';

export interface SourceRect {
  /** Left/top of the visible region in source pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Cover-fit crop: the region of a `srcW × srcH` image that fills a `slotW × slotH` box while keeping
 * the focal point at the same relative position in both (the semantics of CSS
 * `object-fit: cover; object-position: fx% fy%`). `zoom` > 1 magnifies around the focal point.
 * Returns integer pixel bounds clamped to the source.
 */
export function coverCrop(srcW: number, srcH: number, slotW: number, slotH: number, crop?: Partial<Crop>): SourceRect {
  const fx = clamp01(crop?.focalX ?? 0.5);
  const fy = clamp01(crop?.focalY ?? 0.5);
  const zoom = Math.max(1, crop?.zoom ?? 1);
  if (srcW <= 0 || srcH <= 0 || slotW <= 0 || slotH <= 0) return { x: 0, y: 0, w: Math.max(1, srcW), h: Math.max(1, srcH) };

  const scale = Math.max(slotW / srcW, slotH / srcH) * zoom;
  const visW = Math.min(srcW, slotW / scale);
  const visH = Math.min(srcH, slotH / scale);
  let x = (srcW - visW) * fx;
  let y = (srcH - visH) * fy;
  // With zoom the focal point should stay centred rather than anchored by object-position math.
  if (zoom > 1) {
    x = fx * srcW - visW / 2;
    y = fy * srcH - visH / 2;
  }
  x = Math.min(Math.max(0, x), srcW - visW);
  y = Math.min(Math.max(0, y), srcH - visH);
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.max(1, Math.round(visW)),
    h: Math.max(1, Math.round(visH)),
  };
}

/** CSS `object-position` value matching {@link coverCrop} for zoom = 1. */
export function objectPosition(crop?: Partial<Crop>): string {
  const fx = clamp01(crop?.focalX ?? 0.5);
  const fy = clamp01(crop?.focalY ?? 0.5);
  return `${(fx * 100).toFixed(2)}% ${(fy * 100).toFixed(2)}%`;
}

/**
 * Effective pixels per inch of a photo placed in a slot: how many source pixels land on each printed inch
 * after cover-fitting. Below ~200 the print looks soft.
 */
export function effectivePpi(srcW: number, srcH: number, slotWIn: number, slotHIn: number, crop?: Partial<Crop>): number {
  if (srcW <= 0 || srcH <= 0 || slotWIn <= 0 || slotHIn <= 0) return 0;
  const zoom = Math.max(1, crop?.zoom ?? 1);
  const scale = Math.max(slotWIn / srcW, slotHIn / srcH) * zoom; // inches per source pixel
  return 1 / scale;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

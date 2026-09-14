import type { BookFormat, Crop, FaceBox, Page } from '@bookbinder/shared';
import { getTemplate } from './templates.js';

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

/** Faces get this much extra room around the box (fraction of the box size) so hair and chins survive the crop. */
const FACE_MARGIN = 0.35;

/**
 * Focal point that keeps every face inside a cover-fit crop of a `srcRatio` photo in a `slotRatio`
 * slot: the visible window is centred on the union of the (padded) face boxes and clamped to the
 * image. Returns undefined when there are no faces or the whole image is visible anyway. Zoom stays 1.
 */
export function faceFocal(faces: readonly FaceBox[], srcRatio: number, slotRatio: number): Crop | undefined {
  if (faces.length === 0 || !(srcRatio > 0) || !(slotRatio > 0)) return undefined;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const f of faces) {
    const mx = f.w * FACE_MARGIN;
    const my = f.h * FACE_MARGIN;
    x0 = Math.min(x0, f.x - mx);
    y0 = Math.min(y0, f.y - my);
    x1 = Math.max(x1, f.x + f.w + mx);
    y1 = Math.max(y1, f.y + f.h + my);
  }
  x0 = clamp01(x0);
  y0 = clamp01(y0);
  x1 = clamp01(x1);
  y1 = clamp01(y1);
  // Visible fractions of the source after cover-fit (one of them is the whole axis).
  const visW = srcRatio > slotRatio ? slotRatio / srcRatio : 1;
  const visH = srcRatio > slotRatio ? 1 : srcRatio / slotRatio;
  if (visW >= 0.999 && visH >= 0.999) return undefined;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // Window origin that centres the faces, clamped so the window stays inside the image, then
  // expressed as CSS object-position (offset = (1 - vis) * focal).
  const ox = Math.min(Math.max(0, cx - visW / 2), 1 - visW);
  const oy = Math.min(Math.max(0, cy - visH / 2), 1 - visH);
  const focalX = visW < 1 ? ox / (1 - visW) : 0.5;
  const focalY = visH < 1 ? oy / (1 - visH) : 0.5;
  return { focalX: round4(focalX), focalY: round4(focalY), zoom: 1 };
}

function round4(v: number): number {
  return Math.round(clamp01(v) * 10000) / 10000;
}

/**
 * Sets a face-aware crop on every photo slot whose photo has face boxes and no crop yet. The slot's
 * printed aspect comes from the template geometry and the format's trim.
 */
export function applyFaceCrops(pages: readonly Page[], format: BookFormat, faces: ReadonlyMap<string, readonly FaceBox[]>, ratios: ReadonlyMap<string, number>): Page[] {
  return pages.map((page) => {
    const template = getTemplate(page.templateId);
    let changed = false;
    const slots = page.slots.map((content) => {
      if (!content.assetId || content.crop) return content;
      const boxes = faces.get(content.assetId);
      const ratio = ratios.get(content.assetId);
      if (!boxes || boxes.length === 0 || !ratio) return content;
      const spec = template.slots.find((s) => s.id === content.slotId);
      if (!spec) return content;
      const crop = faceFocal(boxes, ratio, (spec.w * format.trimWidthIn) / (spec.h * format.trimHeightIn));
      if (!crop) return content;
      changed = true;
      return { ...content, crop };
    });
    return changed ? { ...page, slots } : page;
  });
}

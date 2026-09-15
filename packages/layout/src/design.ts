import type { BookFormat, Page, SlotContent, SlotFrame, SlotSpec, TextStyle } from '@bookbinder/shared';
import { TextStyle as TextStyleSchema } from '@bookbinder/shared';
import { getTemplate } from './templates.js';

/**
 * Free-form placement (M6). A page (or the cover) draws its template's slots unless a slot content
 * carries a `frame`, and any number of ad-hoc slots (`role` set, ids `photo-…` / `text-…`) on top.
 * Everything here is pure and shared by the renderer, preflight and the editor.
 */

/** A box in template units, as {@link SlotFrame} without rotation and stacking. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A slot as it is drawn: the template spec with any frame applied. */
export interface EffectiveSlot {
  spec: SlotSpec;
  content: SlotContent | undefined;
  frame: SlotFrame;
  /** Stacking order; the drawing order when frames set no `z`. */
  z: number;
  /** True for slots the template does not know (added by the user). */
  adHoc: boolean;
}

export function isAdHocSlot(content: SlotContent): boolean {
  return content.role !== undefined;
}

/** The frame a slot content draws in: its own, else the template slot's box. */
export function frameOf(spec: Pick<SlotSpec, 'x' | 'y' | 'w' | 'h'>, content: SlotContent | undefined): SlotFrame {
  return content?.frame ?? { x: spec.x, y: spec.y, w: spec.w, h: spec.h };
}

/** A synthetic spec for an ad-hoc slot (photo boxes are importance 2 photos; text boxes are text). */
export function adHocSpec(content: SlotContent): SlotSpec {
  const frame = content.frame ?? { x: 0, y: 0, w: 0.1, h: 0.1 };
  return {
    id: content.slotId,
    role: content.role === 'photo' ? 'photo' : 'text',
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    aspect: [],
    importance: 2,
    bleed: false,
  };
}

/**
 * Every slot a page (or cover) draws, template order first then ad-hoc slots in content order, with
 * frames applied and a resolved stacking number. Slots whose content names a template slot that
 * does not exist are ignored (they cannot be drawn).
 */
export function effectiveSlots(templateId: string, slots: readonly SlotContent[]): EffectiveSlot[] {
  const template = getTemplate(templateId);
  const byId = new Map(slots.map((s) => [s.slotId, s]));
  const out: EffectiveSlot[] = [];
  for (const spec of template.slots) {
    const content = byId.get(spec.id);
    const frame = frameOf(spec, content);
    out.push({ spec: { ...spec, x: frame.x, y: frame.y, w: frame.w, h: frame.h }, content, frame, z: frame.z ?? out.length, adHoc: false });
  }
  for (const content of slots) {
    if (!isAdHocSlot(content) || !content.frame) continue;
    const spec = adHocSpec(content);
    out.push({ spec, content, frame: content.frame, z: content.frame.z ?? out.length, adHoc: true });
  }
  return out;
}

/** {@link effectiveSlots} for a page. */
export function pageSlots(page: Pick<Page, 'templateId' | 'slots'>): EffectiveSlot[] {
  return effectiveSlots(page.templateId, page.slots);
}

/** Photo-bearing effective slots (hero, photo and ad-hoc photo boxes) in drawing order. */
export function effectivePhotoSlots(templateId: string, slots: readonly SlotContent[]): EffectiveSlot[] {
  return effectiveSlots(templateId, slots).filter((s) => s.spec.role === 'hero' || s.spec.role === 'photo');
}

/** Whether a page has any hand placement: a frame on a template slot or an ad-hoc slot. */
export function hasOverrides(page: Pick<Page, 'slots'>): boolean {
  return page.slots.some((s) => s.frame !== undefined || isAdHocSlot(s));
}

/** Frame bounds in inches on the page (origin = top-left of the trim box). */
export function frameToIn(frame: Box, format: BookFormat): { x: number; y: number; w: number; h: number } {
  return { x: frame.x * format.trimWidthIn, y: frame.y * format.trimHeightIn, w: frame.w * format.trimWidthIn, h: frame.h * format.trimHeightIn };
}

/** Inverse of {@link frameToIn}. */
export function inToFrame(rect: { x: number; y: number; w: number; h: number }, format: BookFormat): Box {
  return { x: rect.x / format.trimWidthIn, y: rect.y / format.trimHeightIn, w: rect.w / format.trimWidthIn, h: rect.h / format.trimHeightIn };
}

/** Round a frame to 1/1000 of the trim so documents stay short and equal placements compare equal. */
export function roundFrame(frame: SlotFrame): SlotFrame {
  const r = (v: number): number => Math.round(v * 10000) / 10000;
  return {
    x: r(frame.x),
    y: r(frame.y),
    w: r(frame.w),
    h: r(frame.h),
    ...(frame.rotation !== undefined && Math.abs(frame.rotation) >= 0.05 ? { rotation: Math.round(frame.rotation * 10) / 10 } : {}),
    ...(frame.z !== undefined ? { z: frame.z } : {}),
  };
}

/** Text box defaults: body face, 11 pt, left, upright. */
export const DEFAULT_TEXT_STYLE: TextStyle = TextStyleSchema.parse({});

/** A new text box on a page: 60% of the trim wide, an inch tall, centred. */
export function defaultTextFrame(): SlotFrame {
  return { x: 0.2, y: 0.42, w: 0.6, h: 0.16 };
}

/** A new photo box on a page: 45% of the trim wide at the photo's aspect (narrower when that would be taller than 90% of the page), centred. */
export function defaultPhotoFrame(ratio: number, format: BookFormat): SlotFrame {
  const r = Math.max(0.1, ratio);
  let w = 0.45;
  let h = (w * format.trimWidthIn) / r / format.trimHeightIn;
  if (h > 0.9) {
    // Keep the aspect: a tall portrait gets a shorter, narrower box instead of a squashed one.
    h = 0.9;
    w = (h * format.trimHeightIn * r) / format.trimWidthIn;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** The next stacking number above (or below) every slot on the page. */
export function nextZ(templateId: string, slots: readonly SlotContent[], where: 'front' | 'back'): number {
  const zs = effectiveSlots(templateId, slots).map((s) => s.z);
  if (zs.length === 0) return 0;
  return where === 'front' ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
}

/** Prefix an ad-hoc slot id carries for its role. */
export function adHocSlotId(role: 'photo' | 'text', makeId: () => string = () => globalThis.crypto.randomUUID()): string {
  return `${role}-${makeId()}`;
}

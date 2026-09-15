import type { BookCover, BookFormat, Page, SlotContent, SlotFrame, TextStyle } from '@bookbinder/shared';
import { adHocSlotId, clampFrameToPage, DEFAULT_TEXT_STYLE, defaultPhotoFrame, defaultTextFrame, effectiveSlots, frameOf, getTemplate, isAdHocSlot, nextZ, roundFrame } from '@bookbinder/layout';

/**
 * Pure free-form operations (M6) over a slot list: a page or the cover, which both carry a
 * `templateId` and `slots`. Page wrappers below mark the page `custom` so the automatic layout
 * leaves it alone; cover wrappers keep the rest of the cover document.
 */

export interface SlotList {
  templateId: string;
  slots: SlotContent[];
}

export type MakeId = () => string;
const defaultMakeId: MakeId = () => globalThis.crypto.randomUUID();

/** A copy of a slot content without the given keys. */
export function omitKeys(content: SlotContent, ...keys: (keyof SlotContent)[]): SlotContent {
  const out: SlotContent = { slotId: content.slotId };
  for (const [k, v] of Object.entries(content)) if (!keys.includes(k as keyof SlotContent)) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** The frame a slot draws in now (its own or the template's). */
export function currentFrame(list: SlotList, slotId: string): SlotFrame | undefined {
  return effectiveSlots(list.templateId, list.slots).find((s) => s.spec.id === slotId)?.frame;
}

function upsert(slots: readonly SlotContent[], slotId: string, update: (existing: SlotContent | undefined) => SlotContent | undefined): SlotContent[] {
  const existing = slots.find((s) => s.slotId === slotId);
  const next = update(existing);
  if (!existing) return next ? [...slots, next] : [...slots];
  return next ? slots.map((s) => (s.slotId === slotId ? next : s)) : slots.filter((s) => s.slotId !== slotId);
}

/** Sets a slot's frame (rounded); template slots keep their content, unknown slot ids are ignored. */
export function slotsSetFrame(list: SlotList, slotId: string, frame: SlotFrame): SlotContent[] {
  if (!currentFrame(list, slotId)) return [...list.slots];
  return upsert(list.slots, slotId, (existing) => ({ ...(existing ?? { slotId }), frame: roundFrame(frame) }));
}

/** Moves a slot by (dx, dy) template units; with a `format` the box keeps its minimum inside the page's bleed box (pages only; the cover sheet has its own bounds). */
export function slotsNudge(list: SlotList, slotId: string, dx: number, dy: number, format?: BookFormat): SlotContent[] {
  const frame = currentFrame(list, slotId);
  if (!frame) return [...list.slots];
  const moved = { ...frame, x: frame.x + dx, y: frame.y + dy };
  return slotsSetFrame(list, slotId, format ? clampFrameToPage(moved, format) : moved);
}

/** Brings a slot in front of (or behind) every other slot. */
export function slotsSetZ(list: SlotList, slotId: string, where: 'front' | 'back'): SlotContent[] {
  const frame = currentFrame(list, slotId);
  if (!frame) return [...list.slots];
  const z = nextZ(list.templateId, list.slots, where);
  return slotsSetFrame(list, slotId, { ...frame, z });
}

/** Adds a text box; returns the new slot id. */
export function slotsAddText(list: SlotList, text = '', frame: SlotFrame = defaultTextFrame(), style: TextStyle = DEFAULT_TEXT_STYLE, makeId: MakeId = defaultMakeId): { slots: SlotContent[]; slotId: string } {
  const slotId = adHocSlotId('text', makeId);
  const z = nextZ(list.templateId, list.slots, 'front');
  return { slots: [...list.slots, { slotId, role: 'text', text, frame: roundFrame({ ...frame, z }), style }], slotId };
}

/** Adds a photo box holding `assetId`; returns the new slot id. */
export function slotsAddPhoto(list: SlotList, assetId: string, frame: SlotFrame, makeId: MakeId = defaultMakeId): { slots: SlotContent[]; slotId: string } {
  const slotId = adHocSlotId('photo', makeId);
  const z = nextZ(list.templateId, list.slots, 'front');
  return { slots: [...list.slots, { slotId, role: 'photo', assetId, frame: roundFrame({ ...frame, z }) }], slotId };
}

/** Sets the text of any text slot without touching its frame; empty text keeps an ad-hoc box (and hides a template text). */
export function slotsSetText(list: SlotList, slotId: string, text: string): SlotContent[] {
  return upsert(list.slots, slotId, (existing) => ({ ...(existing ?? { slotId }), text }));
}

/** Removes a template text slot's override so the automatic text shows again (the frame stays). */
export function slotsUnsetText(list: SlotList, slotId: string): SlotContent[] {
  return upsert(list.slots, slotId, (existing) => {
    if (!existing) return undefined;
    const rest = omitKeys(existing, 'text');
    return Object.keys(rest).length > 1 ? rest : undefined;
  });
}

/** Sets a text slot's style; `undefined` returns a template slot to the template's own styling. */
export function slotsSetTextStyle(list: SlotList, slotId: string, style: TextStyle | undefined): SlotContent[] {
  return upsert(list.slots, slotId, (existing) => {
    const rest = omitKeys(existing ?? { slotId }, 'style');
    const next = style ? { ...rest, style } : rest;
    return Object.keys(next).length > 1 ? next : undefined;
  });
}

/** Duplicates an ad-hoc text box a quarter inch down and right (photos may sit in one slot only). */
export function slotsDuplicate(list: SlotList, slotId: string, format: BookFormat, makeId: MakeId = defaultMakeId): { slots: SlotContent[]; slotId: string | undefined } {
  const source = list.slots.find((s) => s.slotId === slotId);
  if (!source || source.role !== 'text' || !source.frame) return { slots: [...list.slots], slotId: undefined };
  const id = adHocSlotId('text', makeId);
  const z = nextZ(list.templateId, list.slots, 'front');
  const frame = roundFrame({ ...source.frame, x: source.frame.x + 0.25 / format.trimWidthIn, y: source.frame.y + 0.25 / format.trimHeightIn, z });
  return { slots: [...list.slots, { ...source, slotId: id, frame }], slotId: id };
}

/**
 * Deletes a slot: ad-hoc boxes vanish; a template photo slot is emptied (its frame stays); a
 * template text slot is hidden with an empty override.
 */
export function slotsDelete(list: SlotList, slotId: string): SlotContent[] {
  const existing = list.slots.find((s) => s.slotId === slotId);
  if (existing && isAdHocSlot(existing)) return list.slots.filter((s) => s.slotId !== slotId);
  const spec = getTemplate(list.templateId).slots.find((s) => s.id === slotId);
  if (!spec) return [...list.slots];
  if (spec.role === 'hero' || spec.role === 'photo') {
    return upsert(list.slots, slotId, (e) => {
      if (!e) return undefined;
      const rest = omitKeys(e, 'assetId', 'crop');
      return Object.keys(rest).length > 1 ? rest : undefined;
    });
  }
  return upsert(list.slots, slotId, (e) => ({ ...(e ?? { slotId }), text: '' }));
}

/** Drops every frame, style and ad-hoc box; the template draws the page again. Photos in ad-hoc boxes are freed. */
export function slotsReset(list: SlotList): SlotContent[] {
  return list.slots
    .filter((s) => !isAdHocSlot(s))
    .map((s) => omitKeys(s, 'frame', 'style'))
    .filter((s) => s.assetId || s.text !== undefined || s.crop);
}

/** Empty photo slots (template or ad-hoc) a tray photo can drop into, in drawing order. */
export function emptyPhotoSlotIds(list: SlotList): string[] {
  return effectiveSlots(list.templateId, list.slots)
    .filter((s) => (s.spec.role === 'hero' || s.spec.role === 'photo') && !s.content?.assetId)
    .map((s) => s.spec.id);
}

/**
 * Places a photo on a designed page: the first empty photo slot, else a new photo box (offset a
 * little per existing box so several drops do not stack exactly).
 */
export function slotsPlacePhoto(list: SlotList, assetId: string, ratio: number, format: BookFormat, makeId: MakeId = defaultMakeId): { slots: SlotContent[]; slotId: string } {
  const empty = emptyPhotoSlotIds(list)[0];
  if (empty) return { slots: upsert(list.slots, empty, (e) => ({ ...(e ?? { slotId: empty }), assetId })), slotId: empty };
  const boxes = list.slots.filter((s) => s.role === 'photo').length;
  const base = defaultPhotoFrame(ratio, format);
  const step = 0.03 * (boxes % 6);
  return slotsAddPhoto(list, assetId, { ...base, x: base.x + step, y: base.y + step }, makeId);
}

/**
 * A photo dropped from the tray (M7): onto a photo slot it replaces what is there (the old photo
 * goes back to the tray); anywhere else it becomes a new photo box centred on the drop point.
 * `at` is in template units of the surface (page trim, or cover with back = -1..0).
 */
export function slotsDropPhoto(list: SlotList, assetId: string, ratio: number, format: BookFormat, target: { slotId?: string | undefined; at?: { x: number; y: number } | undefined }, makeId: MakeId = defaultMakeId): { slots: SlotContent[]; slotId: string } {
  if (target.slotId) {
    const slot = effectiveSlots(list.templateId, list.slots).find((s) => s.spec.id === target.slotId);
    if (slot && (slot.spec.role === 'hero' || slot.spec.role === 'photo')) {
      return { slots: upsert(list.slots, slot.spec.id, (e) => omitKeys({ ...(e ?? { slotId: slot.spec.id }), assetId }, 'crop')), slotId: slot.spec.id };
    }
  }
  const base = defaultPhotoFrame(ratio, format);
  const frame = target.at ? { ...base, x: target.at.x - base.w / 2, y: target.at.y - base.h / 2 } : base;
  return slotsAddPhoto(list, assetId, frame, makeId);
}

/* ---------- Page wrappers ---------- */

export interface SlotRef {
  pageIndex: number;
  slotId: string;
}

function withPage(pages: readonly Page[], pageIndex: number, fn: (page: Page) => SlotContent[]): Page[] {
  const page = pages[pageIndex];
  if (!page) return [...pages];
  return pages.map((p, i) => (i === pageIndex ? { ...p, slots: fn(p), custom: true } : p));
}

export function setFrame(pages: readonly Page[], ref: SlotRef, frame: SlotFrame): Page[] {
  return withPage(pages, ref.pageIndex, (p) => slotsSetFrame(p, ref.slotId, frame));
}
export function nudgeSlot(pages: readonly Page[], ref: SlotRef, dxIn: number, dyIn: number, format: BookFormat): Page[] {
  return withPage(pages, ref.pageIndex, (p) => slotsNudge(p, ref.slotId, dxIn / format.trimWidthIn, dyIn / format.trimHeightIn, format));
}
export function setZ(pages: readonly Page[], ref: SlotRef, where: 'front' | 'back'): Page[] {
  return withPage(pages, ref.pageIndex, (p) => slotsSetZ(p, ref.slotId, where));
}
export function addTextBox(pages: readonly Page[], pageIndex: number, text = '', makeId: MakeId = defaultMakeId): { pages: Page[]; slotId: string | undefined } {
  let slotId: string | undefined;
  const out = withPage(pages, pageIndex, (p) => {
    const r = slotsAddText(p, text, undefined, undefined, makeId);
    slotId = r.slotId;
    return r.slots;
  });
  return { pages: out, slotId };
}
export function setBoxText(pages: readonly Page[], ref: SlotRef, text: string): Page[] {
  return withPage(pages, ref.pageIndex, (p) => slotsSetText(p, ref.slotId, text));
}
export function setTextStyle(pages: readonly Page[], ref: SlotRef, style: TextStyle | undefined): Page[] {
  return withPage(pages, ref.pageIndex, (p) => slotsSetTextStyle(p, ref.slotId, style));
}
export function duplicateSlot(pages: readonly Page[], ref: SlotRef, format: BookFormat, makeId: MakeId = defaultMakeId): { pages: Page[]; slotId: string | undefined } {
  let slotId: string | undefined;
  const out = withPage(pages, ref.pageIndex, (p) => {
    const r = slotsDuplicate(p, ref.slotId, format, makeId);
    slotId = r.slotId;
    return r.slots;
  });
  return { pages: out, slotId };
}
export function deleteSlot(pages: readonly Page[], ref: SlotRef): Page[] {
  return withPage(pages, ref.pageIndex, (p) => slotsDelete(p, ref.slotId));
}
/** Back to the template: frames, styles and boxes go, the `custom` flag is cleared. */
export function resetPage(pages: readonly Page[], pageIndex: number): Page[] {
  const page = pages[pageIndex];
  if (!page) return [...pages];
  return pages.map((p, i) => {
    if (i !== pageIndex) return p;
    const rest: Page = { id: p.id, index: p.index, templateId: p.templateId, slots: slotsReset(p), ...(p.chapterId ? { chapterId: p.chapterId } : {}) };
    return rest;
  });
}
/** Places a tray photo on a designed page (see {@link slotsPlacePhoto}). */
export function placePhoto(pages: readonly Page[], pageIndex: number, assetId: string, ratio: number, format: BookFormat, makeId: MakeId = defaultMakeId): { pages: Page[]; slotId: string | undefined } {
  let slotId: string | undefined;
  const out = withPage(pages, pageIndex, (p) => {
    const r = slotsPlacePhoto(p, assetId, ratio, format, makeId);
    slotId = r.slotId;
    return r.slots;
  });
  return { pages: out, slotId };
}

/** {@link slotsDropPhoto} on a page; a drop on a template slot of an automatic page keeps the page automatic. */
export function dropPhoto(pages: readonly Page[], pageIndex: number, assetId: string, ratio: number, format: BookFormat, target: { slotId?: string | undefined; at?: { x: number; y: number } | undefined }, makeId: MakeId = defaultMakeId): { pages: Page[]; slotId: string | undefined } {
  const page = pages[pageIndex];
  if (!page) return { pages: [...pages], slotId: undefined };
  const r = slotsDropPhoto(page, assetId, ratio, format, target, makeId);
  const ontoTemplateSlot = Boolean(target.slotId) && r.slotId === target.slotId && !isAdHocSlot(r.slots.find((s) => s.slotId === r.slotId)!);
  return { pages: pages.map((p, i) => (i === pageIndex ? { ...p, slots: r.slots, ...(ontoTemplateSlot ? {} : { custom: true }) } : p)), slotId: r.slotId };
}

/* ---------- Cover wrappers ---------- */

export function withCoverSlots(cover: BookCover, fn: (list: SlotList) => SlotContent[]): BookCover {
  return { ...cover, slots: fn(cover) };
}

/** The slots of an ad-hoc-free cover carry only template ids; `frameOf` resolves the box either way. */
export function coverFrame(cover: BookCover, slotId: string): SlotFrame | undefined {
  const spec = getTemplate(cover.templateId).slots.find((s) => s.id === slotId);
  const content = cover.slots.find((s) => s.slotId === slotId);
  if (spec) return frameOf(spec, content);
  return content?.frame;
}

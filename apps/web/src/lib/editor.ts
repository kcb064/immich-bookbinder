import type { BookAsset, BookFormat, Crop, Page, SlotContent } from '@bookbinder/shared';
import { FORMAT_PRESETS } from '@bookbinder/shared';
import { assignPhotos, BLANK_TEMPLATE_ID, COLOPHON_TEMPLATE_ID, effectivePhotoSlots, getTemplate, isOpenerTemplate, photoSlots, refitPage, reindexPages, TITLE_TEMPLATE_ID } from '@bookbinder/layout';
import { omitKeys, placePhoto } from './designer.ts';

/** Pure page-list edits behind the editor. Every function returns a new array; nothing is mutated. */

export interface SlotRef {
  pageIndex: number;
  slotId: string;
}

export const MAX_PHOTOS_PER_PAGE = 6;

export type RatioMap = ReadonlyMap<string, number>;

export function ratiosOf(assets: Iterable<BookAsset>): Map<string, number> {
  return new Map([...assets].map((a) => [a.id, a.ratio]));
}

function contentOf(page: Page, slotId: string): SlotContent | undefined {
  return page.slots.find((s) => s.slotId === slotId);
}

/** Asset ids on a page in drawing order (template slots, then photo boxes added by hand). */
export function pageAssetIds(page: Page): string[] {
  return effectivePhotoSlots(page.templateId, page.slots)
    .map((s) => s.content?.assetId)
    .filter((id): id is string => Boolean(id));
}

/** A slot content without its photo (frame, text and style stay with the slot). */
function withoutPhoto(c: SlotContent): SlotContent {
  return omitKeys(c, 'assetId', 'crop');
}

/** Whether a slot content still says anything once emptied of its photo. */
function keeps(c: SlotContent): boolean {
  return Object.keys(c).length > 1;
}

export function isBodyPage(page: Page): boolean {
  return page.templateId !== TITLE_TEMPLATE_ID && page.templateId !== COLOPHON_TEMPLATE_ID;
}

/** The closing page (credits, dates, share QR code); it stays last. */
export function isColophonPage(page: Page): boolean {
  return page.templateId === COLOPHON_TEMPLATE_ID;
}

/** Chapter opener halves (hero photo, title page): their template is fixed and photos are not added to them. */
export function isOpenerPage(page: Page): boolean {
  return isOpenerTemplate(page.templateId);
}

/** Pages whose template the editor may switch and whose photo count may change. */
export function isFlexiblePage(page: Page): boolean {
  return isBodyPage(page) && !isOpenerPage(page);
}

function replaceAt(pages: readonly Page[], index: number, page: Page): Page[] {
  return pages.map((p, i) => (i === index ? page : p));
}

/** Swaps the photos in two slots (same or different pages); crops travel with the photo. */
export function swapSlots(pages: readonly Page[], a: SlotRef, b: SlotRef): Page[] {
  if (a.pageIndex === b.pageIndex && a.slotId === b.slotId) return [...pages];
  const pa = pages[a.pageIndex];
  const pb = pages[b.pageIndex];
  if (!pa || !pb) return [...pages];
  const ca = contentOf(pa, a.slotId);
  const cb = contentOf(pb, b.slotId);
  // The photo and its crop travel; whatever belongs to the slot (text, frame, style, role) stays put.
  const moveInto = (page: Page, slotId: string, from: SlotContent | undefined): Page => {
    const rest = page.slots.filter((s) => s.slotId !== slotId);
    const own = contentOf(page, slotId);
    const next: SlotContent = { ...(own ? withoutPhoto(own) : { slotId }), ...(from?.assetId ? { assetId: from.assetId } : {}), ...(from?.crop ? { crop: from.crop } : {}) };
    return { ...page, slots: keeps(next) ? [...rest, next] : rest };
  };
  if (a.pageIndex === b.pageIndex) {
    return replaceAt(pages, a.pageIndex, moveInto(moveInto(pa, a.slotId, cb), b.slotId, ca));
  }
  let out = replaceAt(pages, a.pageIndex, moveInto(pa, a.slotId, cb));
  out = replaceAt(out, b.pageIndex, moveInto(out[b.pageIndex]!, b.slotId, ca));
  return out;
}

/**
 * Removes a photo from its slot; the page refits to a template with one photo fewer. Opener photo
 * pages and hand-designed pages just empty the slot (the box stays where it was put).
 */
export function removePhoto(pages: readonly Page[], ref: SlotRef, ratios: RatioMap): Page[] {
  const page = pages[ref.pageIndex];
  if (!page) return [...pages];
  if (isOpenerPage(page) || page.custom) {
    return replaceAt(pages, ref.pageIndex, { ...page, slots: page.slots.flatMap((s) => (s.slotId !== ref.slotId ? [s] : keeps(withoutPhoto(s)) ? [withoutPhoto(s)] : [])) });
  }
  const remaining = photoSlots(getTemplate(page.templateId))
    .filter((s) => s.id !== ref.slotId)
    .map((s) => contentOf(page, s.id)?.assetId)
    .filter((id): id is string => Boolean(id));
  return replaceAt(pages, ref.pageIndex, refitPage(page, remaining, ratios));
}

/**
 * Adds a photo to a page: the page refits to a template with one more photo, or when it is full a
 * new page holding just this photo is inserted right after it. A hand-designed page takes the photo
 * in its first empty box or a new photo box instead (M6). Returns the pages and where it landed.
 */
export function addPhoto(
  pages: readonly Page[],
  pageIndex: number,
  assetId: string,
  ratios: RatioMap,
  makeId: () => string = () => globalThis.crypto.randomUUID(),
  format: BookFormat = FORMAT_PRESETS['lulu-square-8.5']!,
): { pages: Page[]; pageIndex: number; slotId?: string | undefined } {
  const page = pages[pageIndex];
  if (page?.custom) {
    const r = placePhoto(pages, pageIndex, assetId, ratios.get(assetId) ?? 1.5, format, makeId);
    return { pages: r.pages, pageIndex, slotId: r.slotId };
  }
  if (!page || !isFlexiblePage(page)) {
    // Title and opener pages keep their template: the photo goes on a new page right after (after
    // the facing title page when this is an opener photo page, so the spread stays intact).
    const skip = page && page.templateId === 'chapter-photo' ? 2 : 1;
    const fresh = refitPage({ id: makeId(), index: 0, templateId: BLANK_TEMPLATE_ID, slots: [], ...(page?.chapterId ? { chapterId: page.chapterId } : {}) }, [assetId], ratios);
    const at = Math.min(pages.length, pageIndex + skip);
    return { pages: reindexPages([...pages.slice(0, at), fresh, ...pages.slice(at)]), pageIndex: at };
  }
  const current = pageAssetIds(page);
  if (current.length < MAX_PHOTOS_PER_PAGE) {
    return { pages: replaceAt(pages, pageIndex, refitPage(page, [...current, assetId], ratios)), pageIndex };
  }
  const fresh = refitPage({ id: makeId(), index: 0, templateId: BLANK_TEMPLATE_ID, slots: [] }, [assetId], ratios);
  return { pages: reindexPages([...pages.slice(0, pageIndex + 1), fresh, ...pages.slice(pageIndex + 1)]), pageIndex: pageIndex + 1 };
}

/** Moves a page to another position (the title page stays first, the colophon last; chapter opener halves stay put). */
export function movePage(pages: readonly Page[], from: number, to: number): Page[] {
  const first = pages[0];
  const last = pages[pages.length - 1];
  const min = first && !isBodyPage(first) ? 1 : 0;
  const max = last && isColophonPage(last) ? pages.length - 2 : pages.length - 1;
  if (from < min || from > max) return [...pages];
  if (isOpenerPage(pages[from]!)) return [...pages];
  const target = Math.max(min, Math.min(max, to));
  if (from === target) return [...pages];
  const out = [...pages];
  const [page] = out.splice(from, 1);
  out.splice(target, 0, page!);
  return reindexPages(out);
}

/** Deletes a page; its photos become unplaced. */
export function removePage(pages: readonly Page[], index: number): Page[] {
  if (index < 0 || index >= pages.length) return [...pages];
  return reindexPages(pages.filter((_, i) => i !== index));
}

export function insertBlankPage(pages: readonly Page[], afterIndex: number, makeId: () => string = () => globalThis.crypto.randomUUID()): Page[] {
  const at = Math.max(0, Math.min(pages.length, afterIndex + 1));
  const blank: Page = { id: makeId(), index: at, templateId: BLANK_TEMPLATE_ID, slots: [] };
  return reindexPages([...pages.slice(0, at), blank, ...pages.slice(at)]);
}

/** Switches a page to another template with the same photo count, re-matching photos to slots. */
export function setTemplate(pages: readonly Page[], pageIndex: number, templateId: string, ratios: RatioMap): Page[] {
  const page = pages[pageIndex];
  if (!page) return [...pages];
  const template = getTemplate(templateId);
  const ids = pageAssetIds(page);
  if (photoSlots(template).length !== ids.length) return [...pages];
  const crops = new Map(page.slots.filter((s) => s.assetId && s.crop).map((s) => [s.assetId!, s.crop!]));
  const textSlots = page.slots.filter((s) => !s.assetId && s.text !== undefined);
  const assigned = assignPhotos(
    template,
    ids.map((id) => ({ id, ratio: ratios.get(id) ?? 1.5 })),
  ).slots.map((s) => (s.assetId && crops.has(s.assetId) ? { ...s, crop: crops.get(s.assetId)! } : s));
  return replaceAt(pages, pageIndex, { ...page, templateId, slots: [...assigned, ...textSlots] });
}

/** The template's caption slot id, if it has one. */
export function captionSlotId(templateId: string): string | undefined {
  return getTemplate(templateId).slots.find((s) => s.role === 'caption')?.id;
}

/** Sets (or clears with an empty string) the user caption of a page. */
export function setCaption(pages: readonly Page[], pageIndex: number, text: string): Page[] {
  const page = pages[pageIndex];
  if (!page) return [...pages];
  const slotId = captionSlotId(page.templateId);
  if (!slotId) return [...pages];
  return setSlotText(pages, pageIndex, slotId, text);
}

export function userCaption(page: Page): string | undefined {
  const slotId = captionSlotId(page.templateId);
  return slotId ? contentOf(page, slotId)?.text : undefined;
}

/** Sets (or clears with an empty string) the text of any text slot, e.g. a chapter title or subtitle. */
export function setSlotText(pages: readonly Page[], pageIndex: number, slotId: string, text: string): Page[] {
  const page = pages[pageIndex];
  if (!page) return [...pages];
  const rest = page.slots.filter((s) => s.slotId !== slotId);
  const existing = contentOf(page, slotId);
  const keep = omitKeys(existing ?? { slotId }, 'text');
  const next: SlotContent = text.trim() ? { ...keep, text } : keep;
  return replaceAt(pages, pageIndex, { ...page, slots: keeps(next) ? [...rest, next] : rest });
}

export function slotText(page: Page, slotId: string): string | undefined {
  return contentOf(page, slotId)?.text;
}

/** Sets or clears the crop (focal point) of a photo slot; undefined restores the centred cover-fit. */
export function setCrop(pages: readonly Page[], ref: SlotRef, crop: Crop | undefined): Page[] {
  const page = pages[ref.pageIndex];
  if (!page) return [...pages];
  return replaceAt(pages, ref.pageIndex, {
    ...page,
    slots: page.slots.map((s) => {
      if (s.slotId !== ref.slotId) return s;
      const restOfSlot = omitKeys(s, 'crop');
      return crop ? { ...restOfSlot, crop } : restOfSlot;
    }),
  });
}

/** Gathered photos that are not on any page, in chronological order. */
export function unplacedAssets(pages: readonly Page[], assets: readonly BookAsset[]): BookAsset[] {
  const placed = new Set(pages.flatMap(pageAssetIds));
  return assets.filter((a) => !placed.has(a.id));
}

/**
 * Undo/redo stack over any document (the editor keeps `{ pages, cover }` in one). A push with a
 * `coalesce` key within {@link COALESCE_MS} of the previous push with the same key replaces the
 * present entry instead of adding one, so a run of nudges or keystrokes undoes as one step.
 */
export interface History<T = Page[]> {
  present: T;
  past: T[];
  future: T[];
  coalesceKey?: string | undefined;
  coalesceAt?: number | undefined;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 800;

export function historyPush<T>(h: History<T>, next: T, coalesce?: { key: string; now?: number }): History<T> {
  if (next === h.present) return h;
  const now = coalesce?.now ?? Date.now();
  if (coalesce && h.coalesceKey === coalesce.key && h.coalesceAt !== undefined && now - h.coalesceAt < COALESCE_MS) {
    return { present: next, past: h.past, future: [], coalesceKey: coalesce.key, coalesceAt: now };
  }
  return { present: next, past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present], future: [], ...(coalesce ? { coalesceKey: coalesce.key, coalesceAt: now } : {}) };
}

export function historyUndo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { present: prev, past: h.past.slice(0, -1), future: [h.present, ...h.future] };
}

export function historyRedo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { present: next, past: [...h.past, h.present], future: rest };
}

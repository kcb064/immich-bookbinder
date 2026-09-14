import type { BookAsset, Crop, Page, SlotContent } from '@bookbinder/shared';
import { assignPhotos, BLANK_TEMPLATE_ID, getTemplate, isOpenerTemplate, photoSlots, refitPage, reindexPages, TITLE_TEMPLATE_ID } from '@bookbinder/layout';

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

/** Asset ids on a page in slot order. */
export function pageAssetIds(page: Page): string[] {
  const t = getTemplate(page.templateId);
  return photoSlots(t)
    .map((s) => contentOf(page, s.id)?.assetId)
    .filter((id): id is string => Boolean(id));
}

export function isBodyPage(page: Page): boolean {
  return page.templateId !== TITLE_TEMPLATE_ID;
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
  const moveInto = (page: Page, slotId: string, from: SlotContent | undefined): Page => {
    const rest = page.slots.filter((s) => s.slotId !== slotId);
    const keepText = contentOf(page, slotId)?.text;
    const next: SlotContent = { slotId, ...(from?.assetId ? { assetId: from.assetId } : {}), ...(from?.crop ? { crop: from.crop } : {}), ...(keepText !== undefined ? { text: keepText } : {}) };
    return { ...page, slots: [...rest, next] };
  };
  if (a.pageIndex === b.pageIndex) {
    return replaceAt(pages, a.pageIndex, moveInto(moveInto(pa, a.slotId, cb), b.slotId, ca));
  }
  let out = replaceAt(pages, a.pageIndex, moveInto(pa, a.slotId, cb));
  out = replaceAt(out, b.pageIndex, moveInto(out[b.pageIndex]!, b.slotId, ca));
  return out;
}

/** Removes a photo from its slot; the page refits to a template with one photo fewer (opener photo pages just empty the slot). */
export function removePhoto(pages: readonly Page[], ref: SlotRef, ratios: RatioMap): Page[] {
  const page = pages[ref.pageIndex];
  if (!page) return [...pages];
  if (isOpenerPage(page)) return replaceAt(pages, ref.pageIndex, { ...page, slots: page.slots.filter((s) => s.slotId !== ref.slotId) });
  const remaining = photoSlots(getTemplate(page.templateId))
    .filter((s) => s.id !== ref.slotId)
    .map((s) => contentOf(page, s.id)?.assetId)
    .filter((id): id is string => Boolean(id));
  return replaceAt(pages, ref.pageIndex, refitPage(page, remaining, ratios));
}

/**
 * Adds a photo to a page: the page refits to a template with one more photo, or when it is full a
 * new page holding just this photo is inserted right after it. Returns the pages and where it landed.
 */
export function addPhoto(pages: readonly Page[], pageIndex: number, assetId: string, ratios: RatioMap, makeId: () => string = () => globalThis.crypto.randomUUID()): { pages: Page[]; pageIndex: number } {
  const page = pages[pageIndex];
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

/** Moves a page to another position (the title page stays first; chapter opener halves stay put). */
export function movePage(pages: readonly Page[], from: number, to: number): Page[] {
  const first = pages[0];
  const min = first && !isBodyPage(first) ? 1 : 0;
  if (from < min || from >= pages.length) return [...pages];
  if (isOpenerPage(pages[from]!)) return [...pages];
  const target = Math.max(min, Math.min(pages.length - 1, to));
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
  const rest = page.slots.filter((s) => s.slotId !== slotId);
  const existing = contentOf(page, slotId);
  const trimmed = text.trim();
  const next: SlotContent | undefined = trimmed ? { slotId, ...(existing?.assetId ? { assetId: existing.assetId } : {}), text } : undefined;
  return replaceAt(pages, pageIndex, { ...page, slots: next ? [...rest, next] : rest });
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
  const trimmed = text.trim();
  const next: SlotContent | undefined = trimmed ? { slotId, ...(existing?.assetId ? { assetId: existing.assetId } : {}), ...(existing?.crop ? { crop: existing.crop } : {}), text } : undefined;
  return replaceAt(pages, pageIndex, { ...page, slots: next ? [...rest, next] : rest });
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
      const restOfSlot: SlotContent = { slotId: s.slotId, ...(s.assetId ? { assetId: s.assetId } : {}), ...(s.text !== undefined ? { text: s.text } : {}) };
      return crop ? { ...restOfSlot, crop } : restOfSlot;
    }),
  });
}

/** Gathered photos that are not on any page, in chronological order. */
export function unplacedAssets(pages: readonly Page[], assets: readonly BookAsset[]): BookAsset[] {
  const placed = new Set(pages.flatMap(pageAssetIds));
  return assets.filter((a) => !placed.has(a.id));
}

/** Undo/redo stack over page lists. */
export interface History {
  present: Page[];
  past: Page[][];
  future: Page[][];
}

export const HISTORY_LIMIT = 100;

export function historyPush(h: History, next: Page[]): History {
  if (next === h.present) return h;
  return { present: next, past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present], future: [] };
}

export function historyUndo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { present: prev, past: h.past.slice(0, -1), future: [h.present, ...h.future] };
}

export function historyRedo(h: History): History {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { present: next, past: [...h.past, h.present], future: rest };
}

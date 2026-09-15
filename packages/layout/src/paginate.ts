import type { BookFormat, Chapter, Page, SlotContent, SlotSpec, Template } from '@bookbinder/shared';
import { normalizePageCount } from './index.js';
import { getTemplate, TEMPLATES } from './templates.js';

/** One photo as the paginator sees it: identity, shape and (optional) capture time. */
export interface PhotoInput {
  id: string;
  /** Width / height. */
  ratio: number;
  takenAt?: string | undefined;
  /** Composite selection score 0..1 (M2); higher scores are steered to hero slots. */
  score?: number | undefined;
  /** Chapter from the book's plan (M3); consecutive photos of one chapter get an opener spread. */
  chapterId?: string | undefined;
}

/** A chapter the paginator should open with a photo + title spread. */
export interface PaginateChapter {
  id: string;
  title: string;
  subtitle?: string | undefined;
}

export interface PaginateOptions {
  format: BookFormat;
  /** Desired total page count, front matter included; the result is normalized to the format's rules. */
  targetPages: number;
  /** Page templates the body may use (kind 'page'); defaults to {@link DEFAULT_BODY_TEMPLATES}. */
  templateIds?: readonly string[];
  /** Start with a title page (default true). */
  titlePage?: boolean;
  /** Chapters to open; photos name theirs through `chapterId`. */
  chapters?: readonly PaginateChapter[] | undefined;
  /** End with a colophon page (credits, dates, the share QR code; M7). Default true. */
  colophon?: boolean;
  /** Id generator, injectable for deterministic tests. */
  makeId?: () => string;
}

export interface PaginateResult {
  pages: Page[];
  /** Chapters actually opened, with the page index of their opener photo. */
  chapters: Chapter[];
  warnings: string[];
}

/** The M1 template set: five single-page grids plus two denser variants for big albums. */
export const DEFAULT_BODY_TEMPLATES: readonly string[] = [
  'one-up-full-bleed',
  'one-up-matted',
  'two-up',
  'three-up',
  'four-up-grid',
  'hero-strip',
  'five-up',
  'mosaic-6',
];

export const TITLE_TEMPLATE_ID = 'title-page';
export const BLANK_TEMPLATE_ID = 'blank';
export const CHAPTER_PHOTO_TEMPLATE_ID = 'chapter-photo';
export const CHAPTER_TITLE_TEMPLATE_ID = 'chapter-title';
export const COLOPHON_TEMPLATE_ID = 'colophon';

/** Templates that never show a page number: front matter, fillers and chapter openers. */
export const NO_FOLIO_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  TITLE_TEMPLATE_ID,
  BLANK_TEMPLATE_ID,
  COLOPHON_TEMPLATE_ID,
  CHAPTER_PHOTO_TEMPLATE_ID,
  CHAPTER_TITLE_TEMPLATE_ID,
]);

/** Whether a template is one half of a chapter opener spread (the editor treats these as fixed). */
export function isOpenerTemplate(templateId: string): boolean {
  return getTemplate(templateId).tags.includes('opener');
}

const defaultMakeId = (): string => globalThis.crypto.randomUUID();

/** Photo-bearing slots of a template in declaration order. */
export function photoSlots(template: Template): SlotSpec[] {
  return template.slots.filter((s) => s.role === 'hero' || s.role === 'photo');
}

/** |ln(ratio / preferred)| against the closest preferred aspect; 0 when the slot has no preference. */
export function aspectCost(ratio: number, slot: SlotSpec): number {
  if (slot.aspect.length === 0) return 0;
  const r = Math.max(0.05, ratio);
  let best = Number.POSITIVE_INFINITY;
  for (const a of slot.aspect) best = Math.min(best, Math.abs(Math.log(r / a)));
  return best;
}

/** Extra cost of putting a high-scoring photo in a low-importance slot (per importance step). */
const SCORE_SLOT_COST = 0.08;

/**
 * Assigns photos to a template's photo slots minimizing total aspect mismatch, with a small tie-breaker
 * that steers higher-scored photos (when scores are present) to higher-importance slots. Tries every
 * permutation (templates hold at most six photos, so 720 candidates) and returns the slot contents
 * plus the mean aspect cost (score steering does not count, so template choice stays aspect-driven).
 */
export function assignPhotos(
  template: Template,
  photos: readonly PhotoInput[],
): { slots: SlotContent[]; cost: number } {
  const slots = photoSlots(template);
  if (photos.length !== slots.length)
    throw new Error(`Template ${template.id} holds ${slots.length} photos, got ${photos.length}`);
  const n = slots.length;
  if (n === 0) return { slots: [], cost: 0 };

  const aspect = slots.map((s) => photos.map((p) => aspectCost(p.ratio, s)));
  const scored = photos.some((p) => p.score !== undefined);
  const cost = slots.map((s, si) =>
    photos.map(
      (p, pi) => aspect[si]![pi]! + (scored ? SCORE_SLOT_COST * (3 - s.importance) * (p.score ?? 0.5) : 0),
    ),
  );
  let best: number[] = [];
  let bestCost = Number.POSITIVE_INFINITY;
  const order: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const walk = (slotIndex: number, acc: number): void => {
    if (acc >= bestCost) return;
    if (slotIndex === n) {
      bestCost = acc;
      best = [...order];
      return;
    }
    for (let p = 0; p < n; p++) {
      if (used[p]) continue;
      used[p] = true;
      order.push(p);
      walk(slotIndex + 1, acc + (cost[slotIndex]?.[p] ?? 0));
      order.pop();
      used[p] = false;
    }
  };
  walk(0, 0);

  let aspectTotal = 0;
  for (let i = 0; i < n; i++) aspectTotal += aspect[i]![best[i] ?? i]!;
  return {
    slots: slots.map((s, i) => ({ slotId: s.id, assetId: photos[best[i] ?? i]!.id })),
    cost: aspectTotal / n,
  };
}

/** Picks the best template of a given photo count for these photos; `avoid` gets a variety penalty. */
export function chooseTemplate(
  photos: readonly PhotoInput[],
  candidates: readonly Template[],
  avoid?: string,
): { template: Template; slots: SlotContent[]; cost: number } | undefined {
  let best: { template: Template; slots: SlotContent[]; cost: number } | undefined;
  for (const t of candidates) {
    if (photoSlots(t).length !== photos.length) continue;
    const a = assignPhotos(t, photos);
    const cost = a.cost + (t.id === avoid ? 0.35 : 0);
    if (!best || cost < best.cost) best = { template: t, slots: a.slots, cost };
  }
  return best;
}

/**
 * The photo that opens a chapter: the best score, nudged towards shapes that fill the full-bleed
 * opener page (square to 3:2). Without scores the best-fitting earliest photo wins.
 */
export function chooseChapterHero(photos: readonly PhotoInput[]): PhotoInput {
  const slot = photoSlots(getTemplate(CHAPTER_PHOTO_TEMPLATE_ID))[0]!;
  let best = photos[0]!;
  let bestCost = Number.POSITIVE_INFINITY;
  photos.forEach((p, i) => {
    const cost = -(p.score ?? 0.5) + 0.12 * aspectCost(p.ratio, slot) + 0.0001 * i;
    if (cost < bestCost) {
      bestCost = cost;
      best = p;
    }
  });
  return best;
}

interface Group {
  chapter: PaginateChapter | undefined;
  photos: PhotoInput[];
}

/** Consecutive photos that share a (known) chapter form a group; photos outside any chapter form their own. */
function groupByChapter(photos: readonly PhotoInput[], chapters: readonly PaginateChapter[]): Group[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const groups: Group[] = [];
  for (const p of photos) {
    const chapter = p.chapterId ? byId.get(p.chapterId) : undefined;
    const current = groups[groups.length - 1];
    if (current && current.chapter === chapter) current.photos.push(p);
    else groups.push({ chapter, photos: [p] });
  }
  return groups;
}

/**
 * Chronological auto-pagination. Photos keep their order across pages (within a page they may be
 * shuffled between slots to match aspect ratios). The number of photos per page follows the density
 * needed to land near `targetPages`; page templates are chosen by aspect fit with a variety penalty.
 * Chapters open on a verso/recto pair (full-bleed hero, then the title page), aligned with a blank
 * when needed. The result is padded with blank pages to the format's page-count rules.
 */
export function paginate(photos: readonly PhotoInput[], opts: PaginateOptions): PaginateResult {
  const makeId = opts.makeId ?? defaultMakeId;
  const warnings: string[] = [];
  const bodyTemplates = (opts.templateIds ?? DEFAULT_BODY_TEMPLATES)
    .map((id) => getTemplate(id))
    .filter((t) => t.kind === 'page' && photoSlots(t).length > 0);
  if (bodyTemplates.length === 0)
    throw new Error('paginate needs at least one page template with photo slots');
  const countsAvailable = [...new Set(bodyTemplates.map((t) => photoSlots(t).length))].sort((a, b) => a - b);
  const withTitle = opts.titlePage ?? true;
  const withColophon = opts.colophon ?? true;

  const pages: Page[] = [];
  const chapters: Chapter[] = [];
  const push = (templateId: string, slots: SlotContent[], chapterId?: string): Page => {
    const page: Page = {
      id: makeId(),
      index: pages.length,
      templateId,
      slots,
      ...(chapterId ? { chapterId } : {}),
    };
    pages.push(page);
    return page;
  };
  if (withTitle) push(TITLE_TEMPLATE_ID, []);

  const groups = groupByChapter(photos, opts.chapters ?? []);
  const openers = groups.filter((g) => g.chapter && g.photos.length > 0).length;
  const target = normalizePageCount(Math.max(opts.targetPages, 1), opts.format);
  // Body pages we aim for: total minus front matter, opener spreads, and the colophon (or one trailing blank).
  const bodyTarget = Math.max(1, target - (withTitle ? 1 : 0) - 1 - 2 * openers);

  let bodyPages = 0;
  let remainingAll = photos.length - openers;
  let previous: string | undefined;

  for (const group of groups) {
    let run = group.photos;
    const chapterId = group.chapter?.id;
    if (group.chapter && run.length > 0) {
      // The opener photo must sit on a verso (odd index) so the title faces it on the recto.
      if (pages.length % 2 === 0) push(BLANK_TEMPLATE_ID, []);
      const hero = chooseChapterHero(run);
      const opener = push(CHAPTER_PHOTO_TEMPLATE_ID, [{ slotId: 'p1', assetId: hero.id }], chapterId);
      push(CHAPTER_TITLE_TEMPLATE_ID, [], chapterId);
      chapters.push({
        id: group.chapter.id,
        title: group.chapter.title,
        ...(group.chapter.subtitle ? { subtitle: group.chapter.subtitle } : {}),
        startsAtPage: opener.index,
      });
      run = run.filter((p) => p !== hero);
    }

    let i = 0;
    while (i < run.length) {
      const remaining = run.length - i;
      const pagesLeft = Math.max(1, bodyTarget - bodyPages);
      const density = remainingAll / pagesLeft;

      let choice: { template: Template; slots: SlotContent[]; cost: number; k: number } | undefined;
      for (const k of countsAvailable) {
        if (k > remaining) break;
        const c = chooseTemplate(run.slice(i, i + k), bodyTemplates, previous);
        if (!c) continue;
        // Density term: how far this count is from what fills the target; larger groups are slightly
        // discouraged so a small album does not collapse into one dense page.
        const densityCost = Math.abs(k - density) * 0.45 + (k >= 5 ? 0.15 : 0);
        const total = c.cost + densityCost;
        if (!choice || total < choice.cost) choice = { ...c, cost: total, k };
      }
      if (!choice) {
        // Only possible when remaining < smallest template count; fall back to the smallest template.
        const k = countsAvailable[0] ?? 1;
        const c = chooseTemplate(run.slice(i, i + Math.min(k, remaining)), bodyTemplates, previous);
        if (!c) break;
        choice = { ...c, k: Math.min(k, remaining) };
      }
      push(choice.template.id, choice.slots, chapterId);
      previous = choice.template.id;
      i += choice.k;
      bodyPages++;
      remainingAll -= choice.k;
    }
  }

  // The colophon closes the book; padding blanks go before it so it stays the last page.
  if (withColophon) push(COLOPHON_TEMPLATE_ID, []);
  // Pad to the format's rules (even count, minimum pages).
  const finalCount = normalizePageCount(pages.length, opts.format);
  if (pages.length > opts.format.maxPages) {
    warnings.push(
      `${pages.length} pages exceeds the ${opts.format.maxPages}-page maximum for ${opts.format.name}; trim the selection or raise the photo density.`,
    );
  }
  while (pages.length < finalCount) push(BLANK_TEMPLATE_ID, []);
  if (withColophon) moveColophonLast(pages);
  if (pages.length > target + 8) {
    warnings.push(
      `Laid out ${pages.length} pages for a ${target}-page target; the album has more photos than fit at a comfortable density.`,
    );
  }
  return { pages, chapters, warnings };
}

/** Moves the colophon page (when there is one) to the end, in place, and re-indexes. */
export function moveColophonLast(pages: Page[]): void {
  const at = pages.findIndex((p) => p.templateId === COLOPHON_TEMPLATE_ID);
  if (at < 0 || at === pages.length - 1) return;
  const [colophon] = pages.splice(at, 1);
  pages.push(colophon!);
  pages.forEach((p, index) => {
    p.index = index;
  });
}

/** Re-numbers `index` after edits (moves, removals) so the array order is authoritative. */
export function reindexPages(pages: readonly Page[]): Page[] {
  return pages.map((p, index) => (p.index === index ? p : { ...p, index }));
}

/** Every asset id placed on the pages, in reading order; each appears at most once in a valid book. */
export function placedAssetIds(pages: readonly Page[]): string[] {
  const out: string[] = [];
  for (const p of pages) for (const s of p.slots) if (s.assetId) out.push(s.assetId);
  return out;
}

/**
 * Returns a copy of `page` holding exactly `assetIds` (in order) on the best-fitting template of that
 * count, keeping the current template when it already fits. Text slot contents are preserved.
 */
export function refitPage(
  page: Page,
  assetIds: readonly string[],
  ratios: ReadonlyMap<string, number>,
  templateIds: readonly string[] = DEFAULT_BODY_TEMPLATES,
): Page {
  const photos: PhotoInput[] = assetIds.map((id) => ({ id, ratio: ratios.get(id) ?? 1.5 }));
  const current = getTemplate(page.templateId);
  const textSlots = page.slots.filter((s) => !s.assetId && s.text !== undefined);
  const crops = new Map(page.slots.filter((s) => s.assetId && s.crop).map((s) => [s.assetId!, s.crop!]));
  const withCrops = (slots: SlotContent[]): SlotContent[] =>
    slots.map((s) => (s.assetId && crops.has(s.assetId) ? { ...s, crop: crops.get(s.assetId)! } : s));

  if (photoSlots(current).length === photos.length && photos.length > 0) {
    const a = assignPhotos(current, photos);
    return { ...page, slots: [...withCrops(a.slots), ...textSlots] };
  }
  if (photos.length === 0) return { ...page, templateId: BLANK_TEMPLATE_ID, slots: textSlots };
  const candidates = templateIds.map((id) => getTemplate(id)).filter((t) => t.kind === 'page');
  const c =
    chooseTemplate(photos, candidates) ??
    chooseTemplate(
      photos,
      TEMPLATES.filter((t) => t.kind === 'page'),
    );
  if (!c) throw new Error(`No page template holds ${photos.length} photos`);
  return { ...page, templateId: c.template.id, slots: [...withCrops(c.slots), ...textSlots] };
}

/** Page templates that could hold `count` photos, best aspect fit first, for the editor's template picker. */
export function templatesForPhotos(
  photos: readonly PhotoInput[],
  templateIds: readonly string[] = DEFAULT_BODY_TEMPLATES,
): Array<{ template: Template; cost: number }> {
  return templateIds
    .map((id) => getTemplate(id))
    .filter((t) => t.kind === 'page' && photoSlots(t).length === photos.length)
    .map((template) => ({ template, cost: assignPhotos(template, photos).cost }))
    .sort((a, b) => a.cost - b.cost);
}

/**
 * Puts hand-designed pages (M6, `custom: true`) back into a fresh automatic layout: each returns to
 * its previous index (or the end), chapter openers that lost their verso are re-aligned with a blank,
 * trailing padding is dropped and the count is normalised again. Chapter `startsAtPage` is
 * recomputed from the merged list. The caller leaves the custom pages' photos out of `paginate`.
 */
export function mergeCustomPages(fresh: readonly Page[], custom: readonly Page[], format: BookFormat, chapters: readonly Chapter[] = [], makeId: () => string = defaultMakeId): { pages: Page[]; chapters: Chapter[] } {
  const merged: Page[] = [...fresh];
  for (const page of [...custom].sort((a, b) => a.index - b.index)) {
    merged.splice(Math.min(page.index, merged.length), 0, page);
  }
  // A chapter opener photo must sit on a verso (odd index) so its title faces it.
  for (let i = 0; i < merged.length; i++) {
    if (merged[i]!.templateId === CHAPTER_PHOTO_TEMPLATE_ID && i % 2 === 0) {
      merged.splice(i, 0, { id: makeId(), index: i, templateId: BLANK_TEMPLATE_ID, slots: [] });
      i++;
    }
  }
  const isPadding = (p: Page): boolean => p.templateId === BLANK_TEMPLATE_ID && p.slots.length === 0 && !p.custom;
  // The colophon sits behind the padding; take it out, trim, pad, and put it back last.
  const colophonAt = merged.findIndex((p) => p.templateId === COLOPHON_TEMPLATE_ID && !p.custom);
  const colophon = colophonAt >= 0 ? merged.splice(colophonAt, 1)[0] : undefined;
  while (merged.length > 1 && isPadding(merged[merged.length - 1]!) && merged.length + (colophon ? 1 : 0) > format.minPages) merged.pop();
  if (colophon) merged.push(colophon);
  const finalCount = normalizePageCount(merged.length, format);
  while (merged.length < finalCount) merged.push({ id: makeId(), index: merged.length, templateId: BLANK_TEMPLATE_ID, slots: [] });
  if (colophon) moveColophonLast(merged);
  const pages = reindexPages(merged);
  const openerOf = new Map<string, number>();
  for (const p of pages) if (p.templateId === CHAPTER_PHOTO_TEMPLATE_ID && p.chapterId && !openerOf.has(p.chapterId)) openerOf.set(p.chapterId, p.index);
  return {
    pages,
    chapters: chapters.map((c) => (openerOf.has(c.id) ? { ...c, startsAtPage: openerOf.get(c.id)! } : c)),
  };
}

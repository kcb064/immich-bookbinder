import type { BookFormat, Page, SlotContent, SlotSpec, Template } from '@bookbinder/shared';
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
}

export interface PaginateOptions {
  format: BookFormat;
  /** Desired total page count, front matter included; the result is normalized to the format's rules. */
  targetPages: number;
  /** Page templates the body may use (kind 'page'); defaults to {@link DEFAULT_BODY_TEMPLATES}. */
  templateIds?: readonly string[];
  /** Start with a title page (default true). */
  titlePage?: boolean;
  /** Id generator, injectable for deterministic tests. */
  makeId?: () => string;
}

export interface PaginateResult {
  pages: Page[];
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
export function assignPhotos(template: Template, photos: readonly PhotoInput[]): { slots: SlotContent[]; cost: number } {
  const slots = photoSlots(template);
  if (photos.length !== slots.length) throw new Error(`Template ${template.id} holds ${slots.length} photos, got ${photos.length}`);
  const n = slots.length;
  if (n === 0) return { slots: [], cost: 0 };

  const aspect = slots.map((s) => photos.map((p) => aspectCost(p.ratio, s)));
  const scored = photos.some((p) => p.score !== undefined);
  const cost = slots.map((s, si) => photos.map((p, pi) => aspect[si]![pi]! + (scored ? SCORE_SLOT_COST * (3 - s.importance) * (p.score ?? 0.5) : 0)));
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
 * Chronological auto-pagination. Photos keep their order across pages (within a page they may be
 * shuffled between slots to match aspect ratios). The number of photos per page follows the density
 * needed to land near `targetPages`; page templates are chosen by aspect fit with a variety penalty.
 * The result is padded with blank pages to the format's page-count rules.
 */
export function paginate(photos: readonly PhotoInput[], opts: PaginateOptions): PaginateResult {
  const makeId = opts.makeId ?? defaultMakeId;
  const warnings: string[] = [];
  const bodyTemplates = (opts.templateIds ?? DEFAULT_BODY_TEMPLATES)
    .map((id) => getTemplate(id))
    .filter((t) => t.kind === 'page' && photoSlots(t).length > 0);
  if (bodyTemplates.length === 0) throw new Error('paginate needs at least one page template with photo slots');
  const countsAvailable = [...new Set(bodyTemplates.map((t) => photoSlots(t).length))].sort((a, b) => a - b);
  const withTitle = opts.titlePage ?? true;

  const pages: Page[] = [];
  const push = (templateId: string, slots: SlotContent[]): void => {
    pages.push({ id: makeId(), index: pages.length, templateId, slots });
  };
  if (withTitle) push(TITLE_TEMPLATE_ID, []);

  const target = normalizePageCount(Math.max(opts.targetPages, 1), opts.format);
  // Body pages we aim for: total minus front matter, leaving room for one trailing blank when odd.
  const bodyTarget = Math.max(1, target - (withTitle ? 1 : 0) - 1);

  let i = 0;
  let previous: string | undefined;
  while (i < photos.length) {
    const remaining = photos.length - i;
    const pagesLeft = Math.max(1, bodyTarget - (pages.length - (withTitle ? 1 : 0)));
    const density = remaining / pagesLeft;

    let choice: { template: Template; slots: SlotContent[]; cost: number; k: number } | undefined;
    for (const k of countsAvailable) {
      if (k > remaining) break;
      const group = photos.slice(i, i + k);
      const c = chooseTemplate(group, bodyTemplates, previous);
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
      const group = photos.slice(i, i + Math.min(k, remaining));
      const c = chooseTemplate(group, bodyTemplates, previous);
      if (!c) break;
      choice = { ...c, k: group.length };
    }
    push(choice.template.id, choice.slots);
    previous = choice.template.id;
    i += choice.k;
  }

  // Pad to the format's rules (even count, minimum pages).
  const finalCount = normalizePageCount(pages.length, opts.format);
  if (pages.length > opts.format.maxPages) {
    warnings.push(`${pages.length} pages exceeds the ${opts.format.maxPages}-page maximum for ${opts.format.name}; trim the selection or raise the photo density.`);
  }
  while (pages.length < finalCount) push(BLANK_TEMPLATE_ID, []);
  if (pages.length > target + 8) {
    warnings.push(`Laid out ${pages.length} pages for a ${target}-page target; the album has more photos than fit at a comfortable density.`);
  }
  return { pages, warnings };
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
export function refitPage(page: Page, assetIds: readonly string[], ratios: ReadonlyMap<string, number>, templateIds: readonly string[] = DEFAULT_BODY_TEMPLATES): Page {
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
  const c = chooseTemplate(photos, candidates) ?? chooseTemplate(photos, TEMPLATES.filter((t) => t.kind === 'page'));
  if (!c) throw new Error(`No page template holds ${photos.length} photos`);
  return { ...page, templateId: c.template.id, slots: [...withCrops(c.slots), ...textSlots] };
}

/** Page templates that could hold `count` photos, best aspect fit first, for the editor's template picker. */
export function templatesForPhotos(photos: readonly PhotoInput[], templateIds: readonly string[] = DEFAULT_BODY_TEMPLATES): Array<{ template: Template; cost: number }> {
  return templateIds
    .map((id) => getTemplate(id))
    .filter((t) => t.kind === 'page' && photoSlots(t).length === photos.length)
    .map((template) => ({ template, cost: assignPhotos(template, photos).cost }))
    .sort((a, b) => a.cost - b.cost);
}

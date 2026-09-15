import type { Book, BookAsset, BookCover, BookFormat, Candidate, FaceBox } from '@bookbinder/shared';
import { FORMAT_PRESETS, chapterIndex, isPicked, planChapters } from '@bookbinder/shared';
import { TITLE_TEMPLATE_ID, applyFaceCrops, coverGeometry, faceFocal, getTemplate, mergeCustomPages, paginate, placedAssetIds } from '@bookbinder/layout';
import { formatHasCover } from '../render/service.js';
import type { ImmichClient } from '../immich/client.js';
import { gatherAssets } from '../immich/gather.js';
import type { CandidateStore } from '../selection/store.js';
import type { BookStore } from './store.js';

export interface LayoutOptions {
  /** Re-fetch the photo list from Immich (default: only when none is stored yet). */
  refetch?: boolean | undefined;
}

export interface LayoutResult {
  book: Book;
  assets: BookAsset[];
  warnings: string[];
}

export class LayoutError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LayoutError';
  }
}

/**
 * Gathers the book's photos (from Immich or the stored list) and lays them out chronologically on
 * the template library, replacing any existing pages. When the selection engine has run, only the
 * picked photos are placed and their scores steer hero slots; otherwise every photo goes in (M1).
 * Chapters come from the same plan the picker budgeted against (M3), so every chapter that kept
 * photos opens with a photo + title spread; face boxes from the selection set each photo's focal point.
 * Hand-designed pages (`custom`, M6) are kept as they are: their photos stay on them and the pages
 * return to their place in the new sequence. The book moves to `editing`.
 */
export async function layoutBook(
  deps: { store: BookStore; candidates: CandidateStore; client: () => ImmichClient | undefined },
  book: Book,
  opts: LayoutOptions = {},
): Promise<LayoutResult> {
  const format = FORMAT_PRESETS[book.formatId];
  if (!format) throw new LayoutError(`Unknown format "${book.formatId}"`, 400);
  if (!book.rules) throw new LayoutError('This book has no selection rules yet', 400);

  const warnings: string[] = [];
  let assets = deps.store.assets(book.id);
  if (opts.refetch || assets.length === 0) {
    const client = deps.client();
    if (!client)
      throw new LayoutError(
        'Immich is not configured. Save a server URL and API key in Settings first.',
        409,
      );
    const gathered = await gatherAssets(client, book.rules);
    warnings.push(...gathered.warnings);
    assets = gathered.assets;
    deps.store.replaceAssets(book.id, assets);
    deps.candidates.prune(
      book.id,
      assets.map((a) => a.id),
    );
  }
  if (assets.length === 0)
    throw new LayoutError('No photos were found for this book. Check its sources in Immich.', 422);

  const candidates = deps.candidates.map(book.id);
  let photos = assets;
  if (candidates.size > 0) {
    photos = assets.filter((a) => {
      const c = candidates.get(a.id);
      return c ? isPicked(c) : false;
    });
    if (photos.length === 0)
      throw new LayoutError(
        'No photos are picked. Keep at least one photo on the review page before laying out.',
        422,
      );
  }

  // Hand-designed pages keep their photos; the automatic layout places the rest around them.
  const custom = book.pages.filter((p) => p.custom);
  const onCustom = new Set(placedAssetIds(custom));
  const customTitle = custom.some((p) => p.templateId === TITLE_TEMPLATE_ID);

  // Chapters are planned over every gathered photo (as the picker did), then only picked photos keep them.
  const plan = planChapters(assets, { mode: book.rules.chapters, targetPages: book.rules.targetPages });
  const chapterOf = chapterIndex(plan);
  const result = paginate(
    photos
      .filter((a) => !onCustom.has(a.id))
      .map((a) => ({
        id: a.id,
        ratio: a.ratio,
        takenAt: a.takenAt,
        score: candidates.get(a.id)?.scores.composite,
        chapterId: chapterOf.get(a.id)?.id,
      })),
    {
      format,
      targetPages: Math.max(1, book.rules.targetPages - custom.length),
      chapters: plan.map((c) => ({ id: c.id, title: c.title, subtitle: c.subtitle })),
      titlePage: !customTitle,
    },
  );
  warnings.push(...result.warnings);

  const faces = new Map<string, readonly FaceBox[]>();
  for (const c of candidates.values()) if (c.faces && c.faces.length > 0) faces.set(c.assetId, c.faces);
  const fresh =
    faces.size > 0
      ? applyFaceCrops(result.pages, format, faces, new Map(assets.map((a) => [a.id, a.ratio])))
      : result.pages;
  const { pages, chapters } = custom.length > 0 ? mergeCustomPages(fresh, custom, format, result.chapters) : { pages: fresh, chapters: result.chapters };
  if (custom.length > 0) warnings.push(`${custom.length} hand-designed page${custom.length === 1 ? ' was' : 's were'} kept as ${custom.length === 1 ? 'it is' : 'they are'}.`);

  // The cover is created once; later layouts keep the user's cover choices.
  const cover = book.cover ?? (formatHasCover(format) ? defaultCover(book, format, pages, assets, candidates) : undefined);
  const saved = deps.store.save({ ...book, pages, chapters, status: 'editing', ...(cover ? { cover } : {}) });
  return { book: saved, assets, warnings };
}

/**
 * The cover a laid-out book starts with: the placed photo with the best composite score (the first
 * placed photo when nothing was scored) as the wrap-around hero, framed on its faces; title, dates
 * and spine text fall back to the book's own metadata (see `coverText` in packages/pages).
 */
export function defaultCover(
  book: Pick<Book, 'luluProduct'>,
  format: BookFormat,
  pages: Book['pages'],
  assets: readonly BookAsset[],
  candidates: ReadonlyMap<string, Candidate>,
): BookCover {
  const placed = placedAssetIds(pages);
  let heroId = placed[0];
  let best = -1;
  for (const id of placed) {
    const score = candidates.get(id)?.scores.composite ?? -1;
    if (score > best) {
      best = score;
      heroId = id;
    }
  }
  const slots: BookCover['slots'] = [];
  if (heroId) {
    const asset = assets.find((a) => a.id === heroId);
    const faces = candidates.get(heroId)?.faces ?? [];
    const g = coverGeometry(format, book.luluProduct, pages.length);
    const slot = getTemplate('cover-editorial').slots.find((s) => s.role === 'hero');
    const crop = asset && slot && faces.length > 0 ? faceFocal(faces, asset.ratio, g.widthIn / g.heightIn) : undefined;
    slots.push({ slotId: slot?.id ?? 'p1', assetId: heroId, ...(crop ? { crop } : {}) });
  }
  return { templateId: 'cover-editorial', slots };
}

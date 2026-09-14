import type { Book, BookAsset } from '@bookbinder/shared';
import { FORMAT_PRESETS } from '@bookbinder/shared';
import { paginate } from '@bookbinder/layout';
import type { ImmichClient } from '../immich/client.js';
import { gatherAssets } from '../immich/gather.js';
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
 * the template library, replacing any existing pages. The book moves to `editing`.
 */
export async function layoutBook(
  deps: { store: BookStore; client: () => ImmichClient | undefined },
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
    if (!client) throw new LayoutError('Immich is not configured. Save a server URL and API key in Settings first.', 409);
    const gathered = await gatherAssets(client, book.rules);
    warnings.push(...gathered.warnings);
    assets = gathered.assets;
    deps.store.replaceAssets(book.id, assets);
  }
  if (assets.length === 0) throw new LayoutError('No photos were found for this book. Check its albums in Immich.', 422);

  const result = paginate(
    assets.map((a) => ({ id: a.id, ratio: a.ratio, takenAt: a.takenAt })),
    { format, targetPages: book.rules.targetPages },
  );
  warnings.push(...result.warnings);

  const saved = deps.store.save({ ...book, pages: result.pages, chapters: [], status: 'editing' });
  return { book: saved, assets, warnings };
}

import type { Book, BookAsset } from '@bookbinder/shared';
import { dateRangeLabel } from './captions.js';
import type { BookMeta, ChapterMeta } from './PageView.js';

/**
 * Web fonts the themes use (docs/design.md). Loaded from Google Fonts by the editor and by the
 * print renderer; every face has a system fallback so an offline render still produces a PDF.
 */
export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300;1,6..72,400&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=Manrope:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap';

export interface BookMetaOptions {
  /** Active share link, printed as a QR code on the colophon (M7). */
  shareUrl?: string | undefined;
}

export function bookMetaFor(book: Pick<Book, 'title' | 'subtitle'> & Partial<Pick<Book, 'chapters' | 'pages' | 'rules'>>, assets: Iterable<BookAsset>, photoCount: number, opts: BookMetaOptions = {}): BookMeta {
  const list = [...assets];
  const chapters = chapterMetaFor(book, new Map(list.map((a) => [a.id, a])));
  return {
    title: book.title,
    subtitle: book.subtitle,
    photoCount,
    dateRange: dateRangeLabel(list),
    ...(chapters.size > 0 ? { chapters } : {}),
    ...(opts.shareUrl ? { shareUrl: opts.shareUrl } : {}),
    ...(book.rules?.chapterMaps ? { chapterMaps: true } : {}),
  };
}

/** Chapter titles with the number of photos their pages hold and, given the assets, where those photos were taken. */
export function chapterMetaFor(book: Partial<Pick<Book, 'chapters' | 'pages'>>, assets?: ReadonlyMap<string, BookAsset>): Map<string, ChapterMeta> {
  const out = new Map<string, ChapterMeta>();
  for (const c of book.chapters ?? []) out.set(c.id, { title: c.title, subtitle: c.subtitle, photoCount: 0, points: [] });
  for (const p of book.pages ?? []) {
    const c = p.chapterId ? out.get(p.chapterId) : undefined;
    if (!c) continue;
    for (const s of p.slots) {
      if (!s.assetId) continue;
      c.photoCount += 1;
      const a = assets?.get(s.assetId);
      if (a && a.lat !== undefined && a.lon !== undefined) c.points!.push({ lat: a.lat, lon: a.lon, takenAt: a.takenAt });
    }
  }
  return out;
}

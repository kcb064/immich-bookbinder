import type { Book, BookAsset } from '@bookbinder/shared';
import { dateRangeLabel } from './captions.js';
import type { BookMeta, ChapterMeta } from './PageView.js';

/**
 * Web fonts the themes use (docs/design.md). Loaded from Google Fonts by the editor and by the
 * print renderer; every face has a system fallback so an offline render still produces a PDF.
 */
export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300;1,6..72,400&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=Manrope:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap';

export function bookMetaFor(book: Pick<Book, 'title' | 'subtitle'> & Partial<Pick<Book, 'chapters' | 'pages'>>, assets: Iterable<BookAsset>, photoCount: number): BookMeta {
  const chapters = chapterMetaFor(book);
  return {
    title: book.title,
    subtitle: book.subtitle,
    photoCount,
    dateRange: dateRangeLabel(assets),
    ...(chapters.size > 0 ? { chapters } : {}),
  };
}

/** Chapter titles with the number of photos their pages hold. */
export function chapterMetaFor(book: Partial<Pick<Book, 'chapters' | 'pages'>>): Map<string, ChapterMeta> {
  const out = new Map<string, ChapterMeta>();
  for (const c of book.chapters ?? []) out.set(c.id, { title: c.title, subtitle: c.subtitle, photoCount: 0 });
  for (const p of book.pages ?? []) {
    const c = p.chapterId ? out.get(p.chapterId) : undefined;
    if (c) c.photoCount += p.slots.filter((s) => s.assetId).length;
  }
  return out;
}

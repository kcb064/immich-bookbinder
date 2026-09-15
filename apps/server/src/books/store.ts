import { Book, BookAsset } from '@bookbinder/shared';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { bookAssets, books, type BookRow } from '../db/schema.js';

export interface BookSummary {
  id: string;
  title: string;
  subtitle?: string;
  status: Book['status'];
  formatId: string;
  themeId: string;
  pageCount: number;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
}

function parseBook(row: BookRow): Book {
  return Book.parse(JSON.parse(row.data));
}

/** Books and their gathered assets. The book document is JSON in `books.data`; assets are rows. */
export class BookStore {
  constructor(private readonly db: Db) {}

  list(): BookSummary[] {
    const rows = this.db.select().from(books).orderBy(desc(books.updatedAt)).all();
    return rows.map((row) => {
      const book = parseBook(row);
      const photoCount = new Set(book.pages.flatMap((p) => p.slots.map((s) => s.assetId).filter(Boolean))).size;
      return {
        id: book.id,
        title: book.title,
        ...(book.subtitle !== undefined ? { subtitle: book.subtitle } : {}),
        status: book.status,
        formatId: book.formatId,
        themeId: book.themeId,
        pageCount: book.pages.length,
        photoCount,
        createdAt: book.createdAt,
        updatedAt: book.updatedAt,
      };
    });
  }

  get(id: string): Book | undefined {
    const row = this.db.select().from(books).where(eq(books.id, id)).get();
    return row ? parseBook(row) : undefined;
  }

  insert(book: Book): void {
    this.db
      .insert(books)
      .values({
        id: book.id,
        title: book.title,
        status: book.status,
        data: JSON.stringify(book),
        createdAt: book.createdAt,
        updatedAt: book.updatedAt,
      })
      .run();
  }

  /** Persists `book` with a fresh updatedAt and returns what was stored. */
  save(book: Book): Book {
    const next: Book = { ...book, updatedAt: new Date().toISOString() };
    this.db
      .update(books)
      .set({ title: next.title, status: next.status, data: JSON.stringify(next), updatedAt: next.updatedAt })
      .where(eq(books.id, next.id))
      .run();
    return next;
  }

  /** Marks the printed content as changed without touching the document (the colophon's share link came or went). */
  touch(id: string): void {
    const updatedAt = new Date().toISOString();
    const book = this.get(id);
    if (!book) return;
    this.db.update(books).set({ data: JSON.stringify({ ...book, updatedAt }), updatedAt }).where(eq(books.id, id)).run();
  }

  /** Changes only the status (column and document); updatedAt stays because no content changed. */
  setStatus(id: string, status: Book['status']): Book | undefined {
    const book = this.get(id);
    if (!book || book.status === status) return book;
    const next: Book = { ...book, status };
    this.db.update(books).set({ status, data: JSON.stringify(next) }).where(eq(books.id, id)).run();
    return next;
  }

  delete(id: string): boolean {
    return this.db.delete(books).where(eq(books.id, id)).run().changes > 0;
  }

  /** Gathered photos in chronological order. */
  assets(bookId: string): BookAsset[] {
    return this.db
      .select()
      .from(bookAssets)
      .where(eq(bookAssets.bookId, bookId))
      .orderBy(asc(bookAssets.position))
      .all()
      .map((r) => BookAsset.parse(JSON.parse(r.data)));
  }

  assetMap(bookId: string): Map<string, BookAsset> {
    return new Map(this.assets(bookId).map((a) => [a.id, a]));
  }

  replaceAssets(bookId: string, assets: readonly BookAsset[]): void {
    this.db.transaction((tx) => {
      tx.delete(bookAssets).where(eq(bookAssets.bookId, bookId)).run();
      const rows = assets.map((a, position) => ({ bookId, assetId: a.id, position, data: JSON.stringify(a) }));
      for (let i = 0; i < rows.length; i += 200) tx.insert(bookAssets).values(rows.slice(i, i + 200)).run();
    });
  }
}

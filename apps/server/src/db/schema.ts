import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Key/value settings. Secret values are stored AES-256-GCM encrypted (see crypto.ts). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
});

/** Admin login sessions; the id is the (signed) cookie value. */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Books: denormalized columns for listing, the full document (shared `Book` schema) as JSON in `data`. */
export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Photos gathered for a book from Immich, in chronological `position` order. `data` is the shared
 * `BookAsset` JSON (cached EXIF subset). Rows are replaced wholesale when the book is re-gathered.
 */
export const bookAssets = sqliteTable(
  'book_assets',
  {
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    assetId: text('asset_id').notNull(),
    position: integer('position').notNull(),
    data: text('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.assetId] })],
);

/** PDF renders (proof or print) of a book; the file lives under DATA_DIR/exports. */
export const renders = sqliteTable('renders', {
  id: text('id').primaryKey(),
  bookId: text('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  pagesTotal: integer('pages_total').notNull().default(0),
  pagesDone: integer('pages_done').notNull().default(0),
  pageCount: integer('page_count'),
  fileSizeBytes: integer('file_size_bytes'),
  filePath: text('file_path'),
  /** JSON array of strings. */
  warnings: text('warnings').notNull().default('[]'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
});

export type SettingRow = typeof settings.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type BookRow = typeof books.$inferSelect;
export type BookAssetRow = typeof bookAssets.$inferSelect;
export type RenderRow = typeof renders.$inferSelect;

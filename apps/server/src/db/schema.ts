import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

/**
 * Renders of a book: PDFs (proof, print, cover) as one file, page PNGs (preview) as a directory,
 * all under DATA_DIR/exports/<book id>. `data` is the shared `RenderData` JSON (cover geometry).
 */
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
  /** JSON `RenderData`, set when done. */
  data: text('data'),
});

/**
 * Selection-engine output per photo: the shared `Candidate` JSON in `data`, with the decision,
 * cluster and composite score denormalized. Rows survive re-runs so user decisions and image
 * analysis are kept; rows for photos no longer in book_assets are pruned.
 */
export const candidates = sqliteTable(
  'candidates',
  {
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    assetId: text('asset_id').notNull(),
    decision: text('decision').notNull(),
    clusterId: text('cluster_id'),
    composite: real('composite').notNull().default(0),
    data: text('data').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.assetId] })],
);

/** Selection jobs (gather, analyse previews, fetch faces, pick); one row per run. */
export const selectionRuns = sqliteTable('selection_runs', {
  id: text('id').primaryKey(),
  bookId: text('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  phase: text('phase').notNull().default('queued'),
  total: integer('total').notNull().default(0),
  done: integer('done').notNull().default(0),
  /** JSON array of strings. */
  warnings: text('warnings').notNull().default('[]'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
});

/**
 * Public share links to a book's viewer (M4). The token is the URL secret; a password, when set,
 * is an argon2 hash checked by POST /s/:token/unlock. Revoked and expired rows are kept for the admin list.
 */
export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  bookId: text('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  passwordHash: text('password_hash'),
  expiresAt: text('expires_at'),
  allowDownload: integer('allow_download', { mode: 'boolean' }).notNull().default(false),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
  lastViewedAt: text('last_viewed_at'),
  views: integer('views').notNull().default(0),
});

export type SettingRow = typeof settings.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type BookRow = typeof books.$inferSelect;
export type BookAssetRow = typeof bookAssets.$inferSelect;
export type RenderRow = typeof renders.$inferSelect;
export type CandidateRow = typeof candidates.$inferSelect;
export type SelectionRunRow = typeof selectionRuns.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;

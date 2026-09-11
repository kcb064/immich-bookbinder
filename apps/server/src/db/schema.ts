import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export type SettingRow = typeof settings.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type BookRow = typeof books.$inferSelect;

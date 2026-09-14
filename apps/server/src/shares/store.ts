import type { CreateShareInput, ShareStatus, ShareView, UpdateShareInput } from '@bookbinder/shared';
import argon2 from 'argon2';
import { desc, eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { shares, type ShareRow } from '../db/schema.js';

/** How long a successful password unlock lasts in the viewer. */
export const SHARE_UNLOCK_TTL_MS = 24 * 60 * 60 * 1000;

export function shareStatus(row: Pick<ShareRow, 'revokedAt' | 'expiresAt'>, now = Date.now()): ShareStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) return 'expired';
  return 'active';
}

function expiryFromDays(days: number | null | undefined, now: number): string | null | undefined {
  if (days === undefined) return undefined;
  if (days === null) return null;
  return new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Owns the `shares` table. Tokens are 32 random bytes (base64url) and appear only in the share URL;
 * passwords are argon2 hashes. Rows are never deleted by the app: revoking keeps the history and
 * makes the link answer 410.
 */
export class ShareStore {
  constructor(private readonly db: Db) {}

  list(bookId: string): ShareRow[] {
    return this.db.select().from(shares).where(eq(shares.bookId, bookId)).orderBy(desc(shares.createdAt)).all();
  }

  get(id: string): ShareRow | undefined {
    return this.db.select().from(shares).where(eq(shares.id, id)).get();
  }

  byToken(token: string): ShareRow | undefined {
    if (!token) return undefined;
    return this.db.select().from(shares).where(eq(shares.token, token)).get();
  }

  async create(bookId: string, input: CreateShareInput, now = Date.now()): Promise<ShareRow> {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const passwordHash = input.password ? await argon2.hash(input.password) : null;
    this.db
      .insert(shares)
      .values({
        id,
        bookId,
        token,
        passwordHash,
        expiresAt: expiryFromDays(input.expiresInDays, now) ?? null,
        allowDownload: input.allowDownload,
        createdAt: new Date(now).toISOString(),
      })
      .run();
    return this.get(id)!;
  }

  async update(id: string, input: UpdateShareInput, now = Date.now()): Promise<ShareRow | undefined> {
    const row = this.get(id);
    if (!row) return undefined;
    const patch: Partial<typeof shares.$inferInsert> = {};
    const expiresAt = expiryFromDays(input.expiresInDays, now);
    if (expiresAt !== undefined) patch.expiresAt = expiresAt;
    if (input.password !== undefined) patch.passwordHash = input.password === null ? null : await argon2.hash(input.password);
    if (input.allowDownload !== undefined) patch.allowDownload = input.allowDownload;
    if (Object.keys(patch).length > 0) this.db.update(shares).set(patch).where(eq(shares.id, id)).run();
    return this.get(id);
  }

  revoke(id: string, now = Date.now()): ShareRow | undefined {
    const row = this.get(id);
    if (!row) return undefined;
    if (!row.revokedAt) this.db.update(shares).set({ revokedAt: new Date(now).toISOString() }).where(eq(shares.id, id)).run();
    return this.get(id);
  }

  /** Counts a viewer opening the book (once per book.json fetch). */
  touch(id: string, now = Date.now()): void {
    const row = this.get(id);
    if (!row) return;
    this.db.update(shares).set({ views: row.views + 1, lastViewedAt: new Date(now).toISOString() }).where(eq(shares.id, id)).run();
  }

  async verifyPassword(row: ShareRow, password: string): Promise<boolean> {
    if (!row.passwordHash) return true;
    try {
      return await argon2.verify(row.passwordHash, password);
    } catch {
      return false;
    }
  }

  /** The admin view of a row; `base` is the public origin the link is built on. */
  view(row: ShareRow, base: string, warning?: string): ShareView {
    return {
      id: row.id,
      bookId: row.bookId,
      url: `${base.replace(/\/+$/, '')}/s/${row.token}`,
      status: shareStatus(row),
      hasPassword: row.passwordHash !== null,
      allowDownload: row.allowDownload,
      ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
      ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
      createdAt: row.createdAt,
      ...(row.lastViewedAt ? { lastViewedAt: row.lastViewedAt } : {}),
      views: row.views,
      ...(warning ? { warning } : {}),
    };
  }
}

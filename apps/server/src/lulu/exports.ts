import { desc, eq, lt } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Db } from '../db/index.js';
import { exports, type ExportRow } from '../db/schema.js';

/** Export URLs live this long; Lulu downloads within minutes, the rest is slack for retries. */
export const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** base64url of 48 bytes is 64 characters (the WAF rule in deploy-dockge.md mentions the length). */
export const EXPORT_TOKEN_RE = /^[A-Za-z0-9_-]{64}$/;

export function exportPath(token: string): string {
  return `/public/exports/${token}.pdf`;
}

/** Hex MD5 of a file, streamed. */
export async function md5File(path: string): Promise<string> {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Owns the `exports` table: unauthenticated, expiring PDF URLs Lulu fetches print files from (M5).
 * A token is created per order attempt and file; the render's file is streamed by
 * `GET /public/exports/:token.pdf` until the expiry. Expired rows are pruned on create.
 */
export class ExportStore {
  constructor(private readonly db: Db) {}

  get(id: string): ExportRow | undefined {
    return this.db.select().from(exports).where(eq(exports.id, id)).get();
  }

  byToken(token: string): ExportRow | undefined {
    if (!EXPORT_TOKEN_RE.test(token)) return undefined;
    return this.db.select().from(exports).where(eq(exports.token, token)).get();
  }

  list(bookId: string): ExportRow[] {
    return this.db.select().from(exports).where(eq(exports.bookId, bookId)).orderBy(desc(exports.createdAt)).all();
  }

  /** The file an export streams: the render's PDF, or the probe's own file. */
  filePath(row: ExportRow, renderFile: (renderId: string) => string | undefined): string | undefined {
    return row.renderId ? renderFile(row.renderId) : (row.filePath ?? undefined);
  }

  /**
   * Creates an export for a done render whose PDF is at `filePath` (or, without a render, a
   * throwaway file for the reachability probe); computes the MD5 Lulu checks.
   */
  async create(input: { bookId?: string; renderId?: string; filePath: string; ttlMs?: number }, now = Date.now()): Promise<ExportRow> {
    this.db.delete(exports).where(lt(exports.expiresAt, new Date(now).toISOString())).run();
    const id = randomUUID();
    const token = randomBytes(48).toString('base64url');
    const md5 = await md5File(input.filePath);
    this.db
      .insert(exports)
      .values({
        id,
        bookId: input.bookId ?? null,
        renderId: input.renderId ?? null,
        filePath: input.renderId ? null : input.filePath,
        token,
        md5,
        expiresAt: new Date(now + (input.ttlMs ?? EXPORT_TTL_MS)).toISOString(),
        createdAt: new Date(now).toISOString(),
      })
      .run();
    return this.get(id)!;
  }

  isExpired(row: Pick<ExportRow, 'expiresAt'>, now = Date.now()): boolean {
    return new Date(row.expiresAt).getTime() <= now;
  }

  countDownload(id: string): void {
    const row = this.get(id);
    if (row) this.db.update(exports).set({ downloads: row.downloads + 1 }).where(eq(exports.id, id)).run();
  }

  delete(id: string): void {
    this.db.delete(exports).where(eq(exports.id, id)).run();
  }
}

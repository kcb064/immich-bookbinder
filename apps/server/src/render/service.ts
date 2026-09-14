import { FORMAT_PRESETS, THEMES, type Book, type RenderJob, type RenderKind } from '@bookbinder/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BookStore } from '../books/store.js';
import type { Db } from '../db/index.js';
import { renders, type RenderRow } from '../db/schema.js';
import type { ImmichClient } from '../immich/client.js';
import { ImageStore } from './images.js';
import type { ChromiumRenderer } from './renderer.js';

export interface RenderServiceDeps {
  db: Db;
  store: BookStore;
  renderer: ChromiumRenderer;
  client: () => ImmichClient | undefined;
  exportsDir: string;
  cacheDir: string;
  log: FastifyBaseLogger;
  /** Pages per Chromium document. */
  batchSize?: number;
  webFonts?: boolean;
}

export function toRenderJob(row: RenderRow): RenderJob {
  return {
    id: row.id,
    bookId: row.bookId,
    kind: row.kind as RenderKind,
    status: row.status as RenderJob['status'],
    pagesTotal: row.pagesTotal,
    pagesDone: row.pagesDone,
    ...(row.pageCount !== null ? { pageCount: row.pageCount } : {}),
    ...(row.fileSizeBytes !== null ? { fileSizeBytes: row.fileSizeBytes } : {}),
    warnings: safeWarnings(row.warnings),
    ...(row.error !== null ? { error: row.error } : {}),
    createdAt: row.createdAt,
    ...(row.startedAt !== null ? { startedAt: row.startedAt } : {}),
    ...(row.finishedAt !== null ? { finishedAt: row.finishedAt } : {}),
    ...(row.status === 'done' && row.filePath ? { downloadUrl: `/api/books/${row.bookId}/renders/${row.id}/pdf` } : {}),
  };
}

function safeWarnings(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Owns the `renders` table and a serial in-process queue: one Chromium render at a time so a NAS
 * never runs two browsers. Rows left `queued`/`running` by a crash are failed at startup.
 */
export class RenderService {
  private queue: Promise<void> = Promise.resolve();
  private readonly imageStores = new WeakMap<ImmichClient, ImageStore>();

  constructor(private readonly deps: RenderServiceDeps) {
    const stale = deps.db.select().from(renders).where(inArray(renders.status, ['queued', 'running'])).all();
    if (stale.length > 0) {
      deps.db
        .update(renders)
        .set({ status: 'error', error: 'Interrupted by a server restart', finishedAt: new Date().toISOString() })
        .where(inArray(renders.status, ['queued', 'running']))
        .run();
      deps.log.warn({ count: stale.length }, 'failed renders interrupted by restart');
    }
  }

  list(bookId: string): RenderJob[] {
    return this.deps.db.select().from(renders).where(eq(renders.bookId, bookId)).orderBy(desc(renders.createdAt)).all().map(toRenderJob);
  }

  get(id: string): RenderJob | undefined {
    const row = this.deps.db.select().from(renders).where(eq(renders.id, id)).get();
    return row ? toRenderJob(row) : undefined;
  }

  filePath(id: string): string | undefined {
    const row = this.deps.db.select().from(renders).where(eq(renders.id, id)).get();
    return row?.status === 'done' && row.filePath ? row.filePath : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const row = this.deps.db.select().from(renders).where(eq(renders.id, id)).get();
    if (!row) return false;
    if (row.status === 'running') throw new Error('Cannot delete a render while it is running');
    this.deps.db.delete(renders).where(eq(renders.id, id)).run();
    if (row.filePath) await rm(row.filePath, { force: true });
    return true;
  }

  /** Queues a render and returns its row immediately; progress is polled via get(). */
  create(book: Book, kind: RenderKind): RenderJob {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.deps.db
      .insert(renders)
      .values({ id, bookId: book.id, kind, status: 'queued', pagesTotal: book.pages.length, pagesDone: 0, createdAt: now })
      .run();
    this.queue = this.queue.then(() => this.run(id)).catch((err) => this.deps.log.error(err, 'render queue error'));
    return this.get(id)!;
  }

  /** Resolves when every queued render has finished (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  private update(id: string, patch: Partial<typeof renders.$inferInsert>): void {
    this.deps.db.update(renders).set(patch).where(eq(renders.id, id)).run();
  }

  private async run(id: string): Promise<void> {
    const row = this.deps.db.select().from(renders).where(eq(renders.id, id)).get();
    if (!row || row.status !== 'queued') return;
    const startedAt = new Date().toISOString();
    this.update(id, { status: 'running', startedAt });
    const log = this.deps.log.child({ renderId: id, bookId: row.bookId, kind: row.kind });
    try {
      const book = this.deps.store.get(row.bookId);
      if (!book) throw new Error('Book was deleted');
      if (book.pages.length === 0) throw new Error('The book has no pages yet; run the layout first');
      const format = FORMAT_PRESETS[book.formatId];
      if (!format) throw new Error(`Unknown format ${book.formatId}`);
      const theme = THEMES[book.themeId] ?? THEMES['warm-editorial']!;
      const client = this.deps.client();
      if (!client) throw new Error('Immich is not configured');
      let images = this.imageStores.get(client);
      if (!images) {
        images = new ImageStore(this.deps.cacheDir, client);
        this.imageStores.set(client, images);
      }
      const assets = this.deps.store.assetMap(book.id);
      const kind = row.kind as RenderKind;
      log.info({ pages: book.pages.length }, 'render started');

      let lastWrite = 0;
      const out = await this.deps.renderer.render({
        book,
        format,
        theme,
        assets,
        kind,
        images,
        ...(this.deps.batchSize !== undefined ? { batchSize: this.deps.batchSize } : {}),
        ...(this.deps.webFonts !== undefined ? { webFonts: this.deps.webFonts } : {}),
        onProgress: (pagesDone, pagesTotal) => {
          const now = Date.now();
          if (now - lastWrite > 250 || pagesDone === pagesTotal) {
            lastWrite = now;
            this.update(id, { pagesDone, pagesTotal });
          }
        },
      });

      const dir = join(this.deps.exportsDir, book.id);
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `${id}.pdf`);
      await writeFile(filePath, out.pdf);
      this.update(id, {
        status: 'done',
        pageCount: out.pageCount,
        pagesDone: book.pages.length,
        fileSizeBytes: out.pdf.byteLength,
        filePath,
        warnings: JSON.stringify(out.warnings),
        finishedAt: new Date().toISOString(),
      });
      if (kind === 'print' && book.status === 'editing') this.deps.store.save({ ...book, status: 'rendered' });
      log.info({ pageCount: out.pageCount, bytes: out.pdf.byteLength, warnings: out.warnings.length }, 'render finished');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'render failed');
      this.update(id, { status: 'error', error: message, finishedAt: new Date().toISOString() });
    }
  }
}

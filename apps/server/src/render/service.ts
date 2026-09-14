import { FORMAT_PRESETS, RenderData, THEMES, type Book, type BookCover, type BookFormat, type CoverGeometry, type RenderJob, type RenderKind } from '@bookbinder/shared';
import { coverGeometry } from '@bookbinder/layout';
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
import { PREVIEW_COVER_FILE, previewPageFile, type ChromiumRenderer } from './renderer.js';

/** Render kinds that produce one PDF file (the rest write a directory of PNGs). */
export const PDF_KINDS: ReadonlySet<RenderKind> = new Set(['proof', 'print', 'cover']);

/** Whether a book's format gets a cover (Lulu formats only; home prints have none). */
export function formatHasCover(format: BookFormat): boolean {
  return format.vendor === 'lulu';
}

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
    ...(row.data !== null ? { data: safeData(row.data) } : {}),
    ...(row.status === 'done' && row.filePath && PDF_KINDS.has(row.kind as RenderKind) ? { downloadUrl: `/api/books/${row.bookId}/renders/${row.id}/pdf` } : {}),
  };
}

function safeData(json: string): RenderData {
  try {
    const parsed = RenderData.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
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

  /** The PDF (or, for previews, the PNG directory) of a done render. */
  filePath(id: string): string | undefined {
    const row = this.deps.db.select().from(renders).where(eq(renders.id, id)).get();
    return row?.status === 'done' && row.filePath ? row.filePath : undefined;
  }

  /** Path of one page PNG of a done preview render, or undefined when the render or page does not exist. */
  previewPagePath(id: string, pageIndex: number): string | undefined {
    const job = this.get(id);
    const dir = this.filePath(id);
    if (!job || !dir || job.kind !== 'preview' || pageIndex < 0 || pageIndex >= (job.pageCount ?? 0)) return undefined;
    return join(dir, previewPageFile(pageIndex));
  }

  previewCoverPath(id: string): string | undefined {
    const job = this.get(id);
    const dir = this.filePath(id);
    if (!job || !dir || job.kind !== 'preview' || !job.data?.hasCover) return undefined;
    return join(dir, PREVIEW_COVER_FILE);
  }

  /** Newest done render of a kind for a book. */
  latest(bookId: string, kind: RenderKind): RenderJob | undefined {
    return this.list(bookId).find((r) => r.kind === kind && r.status === 'done');
  }

  async delete(id: string): Promise<boolean> {
    const row = this.deps.db.select().from(renders).where(eq(renders.id, id)).get();
    if (!row) return false;
    if (row.status === 'running') throw new Error('Cannot delete a render while it is running');
    this.deps.db.delete(renders).where(eq(renders.id, id)).run();
    if (row.filePath) await rm(row.filePath, { force: true, recursive: true });
    return true;
  }

  /** Cover and its geometry for a book, or undefined when the format has no cover or the book none yet. */
  coverFor(book: Book, format: BookFormat): { cover: BookCover; geometry: CoverGeometry } | undefined {
    if (!formatHasCover(format) || !book.cover) return undefined;
    return { cover: book.cover, geometry: coverGeometry(format, book.luluProduct, book.pages.length) };
  }

  /** Queues a render and returns its row immediately; progress is polled via get(). */
  create(book: Book, kind: RenderKind): RenderJob {
    const id = randomUUID();
    const now = new Date().toISOString();
    const format = FORMAT_PRESETS[book.formatId];
    const withCover = format ? Boolean(this.coverFor(book, format)) : false;
    const pagesTotal = kind === 'cover' ? 1 : book.pages.length + (kind === 'preview' && withCover ? 1 : 0);
    this.deps.db
      .insert(renders)
      .values({ id, bookId: book.id, kind, status: 'queued', pagesTotal, pagesDone: 0, createdAt: now })
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
      const cover = this.coverFor(book, format);
      if (kind === 'cover' && !formatHasCover(format)) throw new Error(`${format.name} is a home-print format and has no cover`);
      if (kind === 'cover' && !cover) throw new Error('The book has no cover yet; lay it out again or set one on the book page');
      log.info({ pages: book.pages.length }, 'render started');

      let lastWrite = 0;
      const input = {
        book,
        format,
        theme,
        assets,
        kind,
        images,
        cover,
        ...(this.deps.batchSize !== undefined ? { batchSize: this.deps.batchSize } : {}),
        ...(this.deps.webFonts !== undefined ? { webFonts: this.deps.webFonts } : {}),
        onProgress: (pagesDone: number, pagesTotal: number) => {
          const now = Date.now();
          if (now - lastWrite > 250 || pagesDone === pagesTotal) {
            lastWrite = now;
            this.update(id, { pagesDone, pagesTotal });
          }
        },
      };

      const dir = join(this.deps.exportsDir, book.id);
      await mkdir(dir, { recursive: true });
      if (kind === 'preview') {
        const filePath = join(dir, id);
        const out = await this.deps.renderer.renderPreviews(input, filePath);
        this.update(id, {
          status: 'done',
          pageCount: out.pageCount,
          pagesDone: row.pagesTotal,
          fileSizeBytes: out.bytes,
          filePath,
          warnings: JSON.stringify(out.warnings),
          data: JSON.stringify({ hasCover: out.hasCover } satisfies RenderData),
          finishedAt: new Date().toISOString(),
        });
        log.info({ pageCount: out.pageCount, hasCover: out.hasCover, bytes: out.bytes, warnings: out.warnings.length }, 'preview finished');
        return;
      }

      const out = await this.deps.renderer.render(input);
      const filePath = join(dir, `${id}.pdf`);
      await writeFile(filePath, out.pdf);
      const data: RenderData | undefined = kind === 'cover' && cover ? { cover: { geometry: cover.geometry, pageCount: book.pages.length } } : undefined;
      this.update(id, {
        status: 'done',
        pageCount: out.pageCount,
        pagesDone: row.pagesTotal,
        fileSizeBytes: out.pdf.byteLength,
        filePath,
        warnings: JSON.stringify(out.warnings),
        ...(data ? { data: JSON.stringify(data) } : {}),
        finishedAt: new Date().toISOString(),
      });
      // Status only: the content did not change, so updatedAt stays put (preflight compares it to render times).
      if (kind === 'print' && book.status === 'editing') this.deps.store.setStatus(book.id, 'rendered');
      log.info({ pageCount: out.pageCount, bytes: out.pdf.byteLength, warnings: out.warnings.length }, 'render finished');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'render failed');
      this.update(id, { status: 'error', error: message, finishedAt: new Date().toISOString() });
    }
  }
}

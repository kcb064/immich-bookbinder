import { FORMAT_PRESETS, RenderData, luluPodPackageId, resolveTheme, type Book, type BookCover, type BookFormat, type CoverGeometry, type RenderJob, type RenderKind } from '@bookbinder/shared';
import { coverGeometry, type CoverOverride } from '@bookbinder/layout';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BookStore } from '../books/store.js';
import type { Db } from '../db/index.js';
import { exports, renders, type RenderRow } from '../db/schema.js';
import type { ImmichClient } from '../immich/client.js';
import { ImageStore } from './images.js';
import type { NotifyEvent } from '../notify/notifier.js';
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
  /**
   * Exact cover sheet size for a Lulu product and page count (M5: Lulu's /cover-dimensions/), or
   * undefined when Lulu is not connected; a throw is reported as a render warning.
   */
  coverDimensions?: (podPackageId: string, pageCount: number) => Promise<CoverOverride | undefined>;
  /** Public viewer link of the book's active share, printed as a QR code on the colophon (M7); undefined = none. */
  shareUrl?: (bookId: string) => string | undefined;
  /** Fired when a render finishes or fails (M7 notifications). */
  notify?: (event: NotifyEvent) => void;
  /** Done renders kept per book and kind (default {@link KEEP_RENDERS_PER_KIND}). */
  keepPerKind?: number;
}

/**
 * Done renders kept per book and kind, newest first. A 300 ppi print PDF runs to hundreds of
 * megabytes, so older ones go with their files once a new one lands; a render an unexpired export
 * points at (an order Lulu may still download) is spared.
 */
export const KEEP_RENDERS_PER_KIND = 3;

/** Warning on cover and preview renders sized with the caliper estimate instead of Lulu's answer. */
export const SPINE_ESTIMATED_WARNING = 'Spine width estimated; connect Lulu for exact dimensions';

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

  /**
   * Deletes the book's done renders of a kind beyond the newest `keep`, files included, sparing
   * those an unexpired export still points at. Returns how many went.
   */
  async prune(bookId: string, kind: RenderKind, keep = this.deps.keepPerKind ?? KEEP_RENDERS_PER_KIND): Promise<number> {
    const done = this.list(bookId)
      .filter((r) => r.kind === kind && r.status === 'done')
      .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt));
    const old = done.slice(Math.max(0, keep));
    if (old.length === 0) return 0;
    const held = new Set(
      this.deps.db
        .select({ renderId: exports.renderId })
        .from(exports)
        .where(and(inArray(exports.renderId, old.map((r) => r.id)), gt(exports.expiresAt, new Date().toISOString())))
        .all()
        .map((e) => e.renderId),
    );
    let n = 0;
    for (const r of old) {
      if (held.has(r.id)) continue;
      if (await this.delete(r.id)) n += 1;
    }
    if (n > 0) this.deps.log.info({ bookId, kind, deleted: n, kept: keep }, 'old renders pruned');
    return n;
  }

  /** Cover and its (estimated) geometry for a book, or undefined when the format has no cover or the book none yet. */
  coverFor(book: Book, format: BookFormat, override?: CoverOverride): { cover: BookCover; geometry: CoverGeometry } | undefined {
    if (!formatHasCover(format) || !book.cover) return undefined;
    return { cover: book.cover, geometry: coverGeometry(format, book.luluProduct, book.pages.length, override) };
  }

  /**
   * Asks Lulu for the exact sheet size before a cover is drawn; falls back to the estimate with a
   * warning when Lulu is not connected or the call fails.
   */
  private async coverOverride(book: Book, format: BookFormat, warnings: string[]): Promise<CoverOverride | undefined> {
    if (!formatHasCover(format) || !format.luluTrim || !this.deps.coverDimensions) {
      warnings.push(SPINE_ESTIMATED_WARNING);
      return undefined;
    }
    try {
      const override = await this.deps.coverDimensions(luluPodPackageId(format, book.luluProduct), book.pages.length);
      if (!override) warnings.push(SPINE_ESTIMATED_WARNING);
      return override;
    } catch (err) {
      warnings.push(`${SPINE_ESTIMATED_WARNING} (Lulu answered: ${err instanceof Error ? err.message : String(err)})`);
      return undefined;
    }
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
      const theme = resolveTheme(book.themeId, book.themeOverrides);
      const client = this.deps.client();
      if (!client) throw new Error('Immich is not configured');
      let images = this.imageStores.get(client);
      if (!images) {
        images = new ImageStore(this.deps.cacheDir, client);
        this.imageStores.set(client, images);
      }
      const assets = this.deps.store.assetMap(book.id);
      const kind = row.kind as RenderKind;
      if (kind === 'cover' && !formatHasCover(format)) throw new Error(`${format.name} is a home-print format and has no cover`);
      if (kind === 'cover' && !this.coverFor(book, format)) throw new Error('The book has no cover yet; lay it out again or set one on the book page');
      const extraWarnings: string[] = [];
      const drawsCover = (kind === 'cover' || kind === 'preview') && Boolean(this.coverFor(book, format));
      const cover = this.coverFor(book, format, drawsCover ? await this.coverOverride(book, format, extraWarnings) : undefined);
      log.info({ pages: book.pages.length, ...(cover ? { coverSource: cover.geometry.source } : {}) }, 'render started');

      let lastWrite = 0;
      const input = {
        book,
        format,
        theme,
        assets,
        kind,
        images,
        cover,
        shareUrl: this.deps.shareUrl?.(book.id),
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
        const previewData: RenderData = { hasCover: out.hasCover, ...(out.hasCover && cover ? { cover: { geometry: cover.geometry, pageCount: book.pages.length } } : {}) };
        this.update(id, {
          status: 'done',
          pageCount: out.pageCount,
          pagesDone: row.pagesTotal,
          fileSizeBytes: out.bytes,
          filePath,
          warnings: JSON.stringify([...out.warnings, ...(out.hasCover ? extraWarnings : [])]),
          data: JSON.stringify(previewData),
          finishedAt: new Date().toISOString(),
        });
        log.info({ pageCount: out.pageCount, hasCover: out.hasCover, bytes: out.bytes, warnings: out.warnings.length }, 'preview finished');
        this.deps.notify?.(this.finishedEvent(book, kind, out.pageCount, out.warnings.length));
        await this.prune(book.id, kind).catch((err) => log.warn({ err }, 'pruning old renders failed'));
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
        warnings: JSON.stringify([...out.warnings, ...(kind === 'cover' ? extraWarnings : [])]),
        ...(data ? { data: JSON.stringify(data) } : {}),
        finishedAt: new Date().toISOString(),
      });
      // Status only: the content did not change, so updatedAt stays put (preflight compares it to render times).
      if (kind === 'print' && book.status === 'editing') this.deps.store.setStatus(book.id, 'rendered');
      log.info({ pageCount: out.pageCount, bytes: out.pdf.byteLength, warnings: out.warnings.length }, 'render finished');
      this.deps.notify?.(this.finishedEvent(book, kind, out.pageCount, out.warnings.length));
      await this.prune(book.id, kind).catch((err) => log.warn({ err }, 'pruning old renders failed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'render failed');
      this.update(id, { status: 'error', error: message, finishedAt: new Date().toISOString() });
      // A preview writes its PNGs as it goes; a failed one must not leave them behind (delete() only knows done rows).
      if (row.kind === 'preview') await rm(join(this.deps.exportsDir, row.bookId, id), { recursive: true, force: true }).catch(() => undefined);
      const book = this.deps.store.get(row.bookId);
      this.deps.notify?.({
        kind: 'render-failed',
        level: 'error',
        title: `${row.kind} render failed`,
        message: `${book?.title ?? row.bookId}: ${message}`,
        bookId: row.bookId,
        bookTitle: book?.title,
        path: `/books/${encodeURIComponent(row.bookId)}`,
      });
    }
  }

  private finishedEvent(book: Book, kind: RenderKind, pageCount: number, warnings: number): NotifyEvent {
    const what = kind === 'preview' ? 'Preview pages' : `${kind[0]!.toUpperCase()}${kind.slice(1)} PDF`;
    return {
      kind: 'render-done',
      title: `${what} ready`,
      message: `${book.title}: ${pageCount} page${pageCount === 1 ? '' : 's'}${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}.`,
      bookId: book.id,
      bookTitle: book.title,
      path: `/books/${encodeURIComponent(book.id)}`,
    };
  }
}

import { targetPhotosFor, type Book, type BookAsset, type Candidate, type FaceBox, type SelectionPhase, type SelectionRun } from '@bookbinder/shared';
import { buildSelection, type SelectionInput } from '@bookbinder/scoring';
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import pLimit from 'p-limit';
import type { BookStore } from '../books/store.js';
import type { Db } from '../db/index.js';
import { selectionRuns, type SelectionRunRow } from '../db/schema.js';
import { ImmichApiError, type ImmichAssetFace, type ImmichClient } from '../immich/client.js';
import { gatherAssets } from '../immich/gather.js';
import { ImageStore } from '../render/images.js';
import { analyzeFile } from './analyze.js';
import type { CandidateStore } from './store.js';

export interface SelectionServiceDeps {
  db: Db;
  store: BookStore;
  candidates: CandidateStore;
  client: () => ImmichClient | undefined;
  cacheDir: string;
  log: FastifyBaseLogger;
  /** Parallel preview decodes (default: cores - 1, between 1 and 4). */
  concurrency?: number;
}

export interface StartOptions {
  /** Fetch the photo list from Immich again and re-analyse every preview (user decisions are kept). */
  refetch?: boolean | undefined;
}

export function toSelectionRun(row: SelectionRunRow): SelectionRun {
  return {
    id: row.id,
    bookId: row.bookId,
    status: row.status as SelectionRun['status'],
    phase: row.phase as SelectionPhase,
    total: row.total,
    done: row.done,
    warnings: safeWarnings(row.warnings),
    ...(row.error !== null ? { error: row.error } : {}),
    createdAt: row.createdAt,
    ...(row.startedAt !== null ? { startedAt: row.startedAt } : {}),
    ...(row.finishedAt !== null ? { finishedAt: row.finishedAt } : {}),
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

/** Immich face boxes are pixels of `imageWidth` x `imageHeight`; store fractions of the frame. */
export function toFaceBoxes(faces: readonly ImmichAssetFace[]): FaceBox[] {
  const out: FaceBox[] = [];
  for (const f of faces) {
    if (!(f.imageWidth > 0) || !(f.imageHeight > 0)) continue;
    const clamp = (v: number): number => Math.min(1, Math.max(0, v));
    const px1 = clamp(Math.min(f.boundingBoxX1, f.boundingBoxX2) / f.imageWidth);
    const px2 = clamp(Math.max(f.boundingBoxX1, f.boundingBoxX2) / f.imageWidth);
    const py1 = clamp(Math.min(f.boundingBoxY1, f.boundingBoxY2) / f.imageHeight);
    const py2 = clamp(Math.max(f.boundingBoxY1, f.boundingBoxY2) / f.imageHeight);
    const x = px1;
    const y = py1;
    const w = Math.abs(f.boundingBoxX2 - f.boundingBoxX1) / f.imageWidth;
    const h = Math.abs(f.boundingBoxY2 - f.boundingBoxY1) / f.imageHeight;
    if (w <= 0 || h <= 0 || px2 <= px1 || py2 <= py1) continue;
    out.push({
      x,
      y,
      w,
      h,
      ...(f.person?.id ? { personId: f.person.id } : {}),
      ...(f.person?.name ? { name: f.person.name } : {}),
    });
  }
  return out;
}

/**
 * Owns `selection_runs` and a serial in-process queue. A run gathers photos (when needed), analyses
 * every preview not analysed before, fetches face boxes for a shortlist, then builds the selection
 * with the pure scoring package and stores the candidates. User decisions and earlier analysis are
 * kept across runs; only the picks change.
 */
export class SelectionService {
  private queue: Promise<void> = Promise.resolve();
  private readonly imageStores = new WeakMap<ImmichClient, ImageStore>();
  private readonly concurrency: number;

  constructor(private readonly deps: SelectionServiceDeps) {
    this.concurrency = deps.concurrency ?? Math.max(1, Math.min(4, availableParallelism() - 1));
    const stale = deps.db.select().from(selectionRuns).where(inArray(selectionRuns.status, ['queued', 'running'])).all();
    if (stale.length > 0) {
      deps.db
        .update(selectionRuns)
        .set({ status: 'error', error: 'Interrupted by a server restart', finishedAt: new Date().toISOString() })
        .where(inArray(selectionRuns.status, ['queued', 'running']))
        .run();
      deps.log.warn({ count: stale.length }, 'failed selection runs interrupted by restart');
    }
  }

  get(id: string): SelectionRun | undefined {
    const row = this.deps.db.select().from(selectionRuns).where(eq(selectionRuns.id, id)).get();
    return row ? toSelectionRun(row) : undefined;
  }

  latest(bookId: string): SelectionRun | undefined {
    const row = this.deps.db.select().from(selectionRuns).where(eq(selectionRuns.bookId, bookId)).orderBy(desc(selectionRuns.createdAt)).limit(1).get();
    return row ? toSelectionRun(row) : undefined;
  }

  /** The queued or running run for a book, if any. */
  active(bookId: string): SelectionRun | undefined {
    const run = this.latest(bookId);
    return run && (run.status === 'queued' || run.status === 'running') ? run : undefined;
  }

  /** Queues a run (or returns the one already queued for this book) and returns its row immediately. */
  start(book: Book, opts: StartOptions = {}): SelectionRun {
    const queued = this.latest(book.id);
    if (queued && queued.status === 'queued') return queued;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.deps.db.insert(selectionRuns).values({ id, bookId: book.id, status: 'queued', phase: 'queued', createdAt: now }).run();
    this.queue = this.queue.then(() => this.run(id, opts)).catch((err) => this.deps.log.error(err, 'selection queue error'));
    return this.get(id)!;
  }

  /** Resolves when every queued run has finished (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  private update(id: string, patch: Partial<typeof selectionRuns.$inferInsert>): void {
    this.deps.db.update(selectionRuns).set(patch).where(eq(selectionRuns.id, id)).run();
  }

  private async run(id: string, opts: StartOptions): Promise<void> {
    const row = this.deps.db.select().from(selectionRuns).where(eq(selectionRuns.id, id)).get();
    if (!row || row.status !== 'queued') return;
    this.update(id, { status: 'running', phase: 'gather', startedAt: new Date().toISOString() });
    const log = this.deps.log.child({ selectionRunId: id, bookId: row.bookId });
    const warnings: string[] = [];
    try {
      const book = this.deps.store.get(row.bookId);
      if (!book) throw new Error('Book was deleted');
      if (!book.rules) throw new Error('This book has no selection rules yet');
      const client = this.deps.client();
      if (!client) throw new Error('Immich is not configured. Save a server URL and API key in Settings first.');
      let images = this.imageStores.get(client);
      if (!images) {
        images = new ImageStore(this.deps.cacheDir, client);
        this.imageStores.set(client, images);
      }

      // 1. Gather
      let assets = this.deps.store.assets(book.id);
      if (opts.refetch || assets.length === 0) {
        const gathered = await gatherAssets(client, book.rules);
        warnings.push(...gathered.warnings);
        assets = gathered.assets;
        this.deps.store.replaceAssets(book.id, assets);
        this.deps.candidates.prune(book.id, assets.map((a) => a.id));
      }
      if (assets.length === 0) throw new Error('No photos were found for this book. Check its sources in Immich.');
      const existing = this.deps.candidates.map(book.id);
      const reuse = !opts.refetch;

      // 2. Analyse previews not analysed before (all of them on a refetch)
      const todo = reuse ? assets.filter((a) => !existing.get(a.id)?.metrics) : assets;
      this.update(id, { phase: 'analyze', total: todo.length, done: 0 });
      log.info({ photos: assets.length, toAnalyze: todo.length, concurrency: this.concurrency }, 'selection started');
      const analysis = new Map<string, { metrics: Candidate['metrics']; phash: string }>();
      if (reuse) for (const c of existing.values()) if (c.metrics && c.phash) analysis.set(c.assetId, { metrics: c.metrics, phash: c.phash });
      let done = 0;
      let failed = 0;
      let lastWrite = 0;
      const progress = (): void => {
        done++;
        const now = Date.now();
        if (now - lastWrite > 250 || done === todo.length) {
          lastWrite = now;
          this.update(id, { done });
        }
      };
      const limit = pLimit(this.concurrency);
      await Promise.all(
        todo.map((asset) =>
          limit(async () => {
            try {
              const path = await images.preview(asset.id);
              const { phash, ...metrics } = await analyzeFile(path);
              analysis.set(asset.id, { metrics, phash });
            } catch (err) {
              failed++;
              log.debug({ err, assetId: asset.id }, 'preview analysis failed');
            } finally {
              progress();
            }
          }),
        ),
      );
      if (failed > 0) warnings.push(`${failed} photo${failed === 1 ? '' : 's'} could not be analysed and score as average.`);

      const inputFor = (a: BookAsset, faces?: FaceBox[]): SelectionInput => {
        const an = analysis.get(a.id);
        const prev = existing.get(a.id);
        const decision = prev?.decision === 'user-in' || prev?.decision === 'user-out' ? prev.decision : undefined;
        const f = faces ?? (reuse ? prev?.faces : undefined);
        return { asset: a, metrics: an?.metrics, phash: an?.phash, faces: f, decision };
      };
      const targetPhotos = targetPhotosFor(book.rules.targetPages);

      // 3. Faces for a shortlist: the strongest candidates that show people and have no boxes yet.
      const preliminary = buildSelection(assets.map((a) => inputFor(a)), { rules: book.rules, targetPhotos });
      const ranked = [...preliminary.candidates].sort((a, b) => b.scores.composite - a.scores.composite);
      const shortlistSize = Math.min(ranked.length, Math.max(60, targetPhotos * 2));
      const byId = new Map(assets.map((a) => [a.id, a]));
      const needFaces = ranked
        .slice(0, shortlistSize)
        .map((c) => byId.get(c.assetId)!)
        .filter((a) => a.people.length > 0 && (!reuse || !existing.get(a.id)?.faces));
      const faces = new Map<string, FaceBox[]>();
      if (needFaces.length > 0) {
        this.update(id, { phase: 'faces', total: needFaces.length, done: 0 });
        done = 0;
        let faceError: string | undefined;
        const faceLimit = pLimit(Math.min(6, Math.max(2, this.concurrency * 2)));
        await Promise.all(
          needFaces.map((asset) =>
            faceLimit(async () => {
              if (faceError) return;
              try {
                faces.set(asset.id, toFaceBoxes(await client.getFaces(asset.id)));
              } catch (err) {
                if (err instanceof ImmichApiError && (err.status === 403 || err.status === 401)) faceError = err.message;
                else log.debug({ err, assetId: asset.id }, 'face fetch failed');
              } finally {
                progress();
              }
            }),
          ),
        );
        if (faceError) warnings.push(`Face boxes were not fetched (${faceError}); the API key may lack face.read. People still count by name.`);
      }

      // 4. Score, cluster, pick
      this.update(id, { phase: 'pick', total: assets.length, done: assets.length });
      const result = buildSelection(assets.map((a) => inputFor(a, faces.get(a.id))), { rules: book.rules, targetPhotos });
      this.deps.candidates.replace(book.id, result.candidates);
      const latest = this.deps.store.get(book.id);
      if (latest && latest.status === 'draft') this.deps.store.save({ ...latest, status: 'selecting' });

      this.update(id, { status: 'done', phase: 'done', warnings: JSON.stringify(warnings), finishedAt: new Date().toISOString() });
      log.info({ ...result.summary, warnings: warnings.length }, 'selection finished');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'selection failed');
      this.update(id, { status: 'error', error: message, warnings: JSON.stringify(warnings), finishedAt: new Date().toISOString() });
    }
  }
}

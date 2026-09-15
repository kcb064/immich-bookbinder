import {
  AiJobResult,
  AiUsage,
  BurstAnswer,
  CaptionAnswer,
  ForewordAnswer,
  estimateAiCost,
  formatIsoRange,
  type AiJob,
  type AiJobKind,
  type Book,
  type BookAsset,
  type Candidate,
  type Page,
  type Reason,
  type SlotContent,
} from '@bookbinder/shared';
import { CHAPTER_TITLE_TEMPLATE_ID, TITLE_TEMPLATE_ID, effectivePhotoSlots, getTemplate } from '@bookbinder/layout';
import { formatTakenDate, placeLabel } from '@bookbinder/pages';
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { BookStore } from '../books/store.js';
import type { Db } from '../db/index.js';
import { aiJobs, type AiJobRow } from '../db/schema.js';
import type { ImmichClient } from '../immich/client.js';
import type { NotifyEvent } from '../notify/notifier.js';
import { ImageStore } from '../render/images.js';
import type { CandidateStore } from '../selection/store.js';
import type { SettingsStore } from '../settings.js';
import { AiClient, AiError, type AiImage } from './client.js';

export interface AiServiceDeps {
  db: Db;
  books: BookStore;
  candidates: CandidateStore;
  settings: SettingsStore;
  client: () => ImmichClient | undefined;
  cacheDir: string;
  log: FastifyBaseLogger;
  /** Development only: point the SDK at the fake (AI_BASE_URL). */
  baseUrl?: string | undefined;
  notify?: (event: NotifyEvent) => void;
}

/** Thrown for user-facing refusals; the route maps `status` to the HTTP code. */
export class AiServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

/** Pages per captions request (each page sends up to three thumbnails). */
const CAPTION_BATCH = 8;
const THUMBS_PER_PAGE = 3;
/** Bursts with fewer frames than this are left to the scoring engine. */
export const MIN_BURST_FRAMES = 3;

const CAPTION_SYSTEM = `You write captions for a printed photo book. For every page listed you get up to three of its photos (small thumbnails), the capture date and the place. Write one short caption per page: a natural sentence of at most 90 characters, present tense, no hashtags, no emoji, no quotation marks, no camera talk, nothing about image quality. Name places and moments, not people's appearance. If chapters are listed, propose an evocative title of at most five words for each (a place name is fine); do not invent facts.`;

const BURST_SYSTEM = `You judge which frame of a burst of near-identical photos belongs in a printed photo book. Prefer open eyes, natural expressions, sharp subjects, good timing and a clean composition. Answer with the 0-based index of the best frame in the order given and one short reason.`;

const FOREWORD_SYSTEM = `You write the short foreword of a printed photo book: one warm paragraph of 60 to 120 words in the first person plural, present or past tense, no headings, no lists, no emoji, no quotation marks. Use only the facts given (title, dates, places, number of photographs); never invent names or events.`;

export function toAiJob(row: AiJobRow): AiJob {
  return {
    id: row.id,
    bookId: row.bookId,
    kind: row.kind as AiJobKind,
    status: row.status as AiJob['status'],
    model: row.model,
    total: row.total,
    done: row.done,
    ...(row.usage ? { usage: parseJson(AiUsage, row.usage) } : {}),
    ...(row.result ? { result: parseJson(AiJobResult, row.result) } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.createdAt,
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
  };
}

function parseJson<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, json: string): T | undefined {
  try {
    const r = schema.safeParse(JSON.parse(json));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** The caption slot of a page's template, if it has one. */
export function captionSlotOf(page: Pick<Page, 'templateId'>): string | undefined {
  return getTemplate(page.templateId).slots.find((s) => s.role === 'caption' && s.id === 'cap')?.id;
}

/** Sets `text` on a slot content, keeping frame, role and style; adds the content when missing. */
function withSlotText(slots: readonly SlotContent[], slotId: string, text: string): SlotContent[] {
  if (slots.some((s) => s.slotId === slotId)) return slots.map((s) => (s.slotId === slotId ? { ...s, text } : s));
  return [...slots, { slotId, text }];
}

/**
 * The optional Claude features (M7): captions and chapter titles, best-of-burst, foreword. Jobs
 * run one at a time per process and at most one per book is queued or running; every job keeps
 * its token usage and estimated cost. Only `ImageStore.aiThumbnail` output is ever sent.
 */
export class AiService {
  private queue: Promise<void> = Promise.resolve();
  private readonly imageStores = new WeakMap<ImmichClient, ImageStore>();

  constructor(private readonly deps: AiServiceDeps) {
    const stale = deps.db.select().from(aiJobs).where(inArray(aiJobs.status, ['queued', 'running'])).all();
    if (stale.length > 0) {
      deps.db
        .update(aiJobs)
        .set({ status: 'error', error: 'Interrupted by a server restart', finishedAt: new Date().toISOString() })
        .where(inArray(aiJobs.status, ['queued', 'running']))
        .run();
    }
  }

  list(bookId: string): AiJob[] {
    return this.deps.db.select().from(aiJobs).where(eq(aiJobs.bookId, bookId)).orderBy(desc(aiJobs.createdAt)).all().map(toAiJob);
  }

  get(id: string): AiJob | undefined {
    const row = this.deps.db.select().from(aiJobs).where(eq(aiJobs.id, id)).get();
    return row ? toAiJob(row) : undefined;
  }

  active(bookId: string): AiJob | undefined {
    return this.list(bookId).find((j) => j.status === 'queued' || j.status === 'running');
  }

  /** Resolves when every queued job has finished (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  /** The configured client, or a 409 explaining what is missing. */
  requireClient(): AiClient {
    const ai = this.deps.settings.getAi();
    if (!ai.enabled) throw new AiServiceError(409, 'Claude features are off. Turn them on in Settings and add your API key.');
    if (!ai.apiKey) throw new AiServiceError(409, 'No Anthropic API key is saved. Add one in Settings.');
    return new AiClient({ apiKey: ai.apiKey, model: ai.model, baseUrl: this.deps.baseUrl });
  }

  /** One tiny request with the stored key (Settings → Test). */
  async test(): Promise<{ ok: boolean; model: string; error?: string; usage?: AiUsage }> {
    const ai = this.deps.settings.getAi();
    if (!ai.apiKey) return { ok: false, model: ai.model, error: 'No API key is saved.' };
    const client = new AiClient({ apiKey: ai.apiKey, model: ai.model, baseUrl: this.deps.baseUrl });
    try {
      const r = await client.ask({ system: 'Answer with the JSON requested.', text: 'Say hello in one word as {"foreword": "..."}.', schema: ForewordAnswer, maxTokens: 64 });
      return { ok: true, model: ai.model, usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, requests: 1, costUsd: estimateAiCost(ai.model, r.usage.inputTokens, r.usage.outputTokens) } };
    } catch (err) {
      return { ok: false, model: ai.model, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Queues a job (409 when one is already queued or running for the book) and returns it. */
  start(book: Book, kind: AiJobKind, opts: { overwrite?: boolean } = {}): AiJob {
    const client = this.requireClient();
    if (!this.deps.client()) throw new AiServiceError(409, 'Immich is not configured.');
    if (this.active(book.id)) throw new AiServiceError(409, 'A Claude job is already running for this book; wait for it to finish.');
    if (kind !== 'bursts' && book.pages.length === 0) throw new AiServiceError(409, 'Lay out the book first.');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.deps.db.insert(aiJobs).values({ id, bookId: book.id, kind, status: 'queued', model: client.model, createdAt: now }).run();
    this.queue = this.queue.then(() => this.run(id, client, opts)).catch((err) => this.deps.log.error(err, 'ai queue error'));
    return this.get(id)!;
  }

  private update(id: string, patch: Partial<typeof aiJobs.$inferInsert>): void {
    this.deps.db.update(aiJobs).set(patch).where(eq(aiJobs.id, id)).run();
  }

  private images(client: ImmichClient): ImageStore {
    let images = this.imageStores.get(client);
    if (!images) {
      images = new ImageStore(this.deps.cacheDir, client);
      this.imageStores.set(client, images);
    }
    return images;
  }

  private async run(id: string, ai: AiClient, opts: { overwrite?: boolean }): Promise<void> {
    const row = this.deps.db.select().from(aiJobs).where(eq(aiJobs.id, id)).get();
    if (!row || row.status !== 'queued') return;
    this.update(id, { status: 'running', startedAt: new Date().toISOString() });
    const log = this.deps.log.child({ aiJobId: id, bookId: row.bookId, kind: row.kind });
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0, requests: 0, costUsd: 0 };
    const account = (u: { inputTokens: number; outputTokens: number }): void => {
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.requests += 1;
      usage.costUsd = Math.round(estimateAiCost(ai.model, usage.inputTokens, usage.outputTokens) * 1e6) / 1e6;
      this.update(id, { usage: JSON.stringify(usage) });
    };
    const progress = (done: number, total: number): void => this.update(id, { done, total });
    try {
      const book = this.deps.books.get(row.bookId);
      if (!book) throw new Error('Book was deleted');
      const client = this.deps.client();
      if (!client) throw new Error('Immich is not configured');
      const images = this.images(client);
      const ctx: JobContext = { ai, book, images, account, progress, log };
      const result: AiJobResult =
        row.kind === 'captions' ? await this.captions(ctx) : row.kind === 'bursts' ? await this.bursts(ctx) : await this.foreword(ctx, opts.overwrite ?? false);
      this.update(id, { status: 'done', result: JSON.stringify(result), usage: JSON.stringify(usage), finishedAt: new Date().toISOString() });
      log.info({ ...result, ...usage }, 'ai job finished');
    } catch (err) {
      const message = err instanceof AiError ? err.message : err instanceof Error ? err.message : String(err);
      log.error({ err }, 'ai job failed');
      this.update(id, { status: 'error', error: message, usage: JSON.stringify(usage), finishedAt: new Date().toISOString() });
    }
  }

  /* ---------- Captions and chapter titles ---------- */

  private async captions(ctx: JobContext): Promise<AiJobResult> {
    const { ai, book, images } = ctx;
    const assets = this.deps.books.assetMap(book.id);
    // Pages with a caption slot the user has not typed in, and chapter titles not overridden.
    const targets = book.pages.filter((p) => {
      const slotId = captionSlotOf(p);
      if (!slotId) return false;
      const typed = p.slots.find((s) => s.slotId === slotId)?.text;
      return typed === undefined && effectivePhotoSlots(p.templateId, p.slots).some((s) => s.content?.assetId);
    });
    const chapterPages = book.pages.filter((p) => p.templateId === CHAPTER_TITLE_TEMPLATE_ID && p.chapterId && p.slots.find((s) => s.slotId === 'title')?.text === undefined);
    const chapters = book.chapters.filter((c) => chapterPages.some((p) => p.chapterId === c.id));
    const skipped = book.pages.filter((p) => captionSlotOf(p) && !targets.includes(p) && p.slots.some((s) => s.slotId === captionSlotOf(p) && s.text !== undefined)).length;
    let pages = book.pages;
    let written = 0;
    let titles = 0;
    ctx.progress(0, targets.length);
    for (let i = 0; i < targets.length || (i === 0 && chapters.length > 0); i += CAPTION_BATCH) {
      const batch = targets.slice(i, i + CAPTION_BATCH);
      const lines: string[] = [];
      const imgs: AiImage[] = [];
      for (const page of batch) {
        const photos = effectivePhotoSlots(page.templateId, page.slots)
          .map((s) => (s.content?.assetId ? assets.get(s.content.assetId) : undefined))
          .filter((a): a is BookAsset => a !== undefined);
        const first = photos[0];
        lines.push(`Page ${page.index}: ${photos.length} photo${photos.length === 1 ? '' : 's'}${first ? `, taken ${formatTakenDate(first.takenAt) || 'on an unknown date'}${placeLabel(first) ? ` in ${placeLabel(first)}` : ''}` : ''}${photos.some((a) => a.description) ? `; the photographer wrote: "${photos.map((a) => a.description).filter(Boolean).join(' / ')}"` : ''}`);
        for (const [k, a] of photos.slice(0, THUMBS_PER_PAGE).entries()) imgs.push({ jpeg: await images.aiThumbnail(a.id), label: `Page ${page.index}, photo ${k + 1}` });
      }
      if (i === 0) {
        for (const c of chapters) {
          const count = pages.filter((p) => p.chapterId === c.id).reduce((n, p) => n + p.slots.filter((s) => s.assetId).length, 0);
          lines.push(`Chapter ${c.id}: currently "${c.title}"${c.subtitle ? ` (${c.subtitle})` : ''}, ${count} photographs`);
        }
      }
      if (lines.length === 0) break;
      const { data, usage } = await ai.ask({ system: CAPTION_SYSTEM, text: `Book: ${book.title}\n${lines.join('\n')}`, images: imgs, schema: CaptionAnswer, maxTokens: 2048 });
      ctx.account(usage);
      const byPage = new Map(data.captions.map((c) => [c.page, c.caption.trim()]));
      pages = pages.map((p) => {
        const slotId = batch.includes(p) ? captionSlotOf(p) : undefined;
        const text = slotId ? byPage.get(p.index) : undefined;
        if (!slotId || !text) return p;
        written++;
        return { ...p, slots: withSlotText(p.slots, slotId, text) };
      });
      if (i === 0) {
        const byChapter = new Map(data.chapters.map((c) => [c.id, c.title.trim()]));
        pages = pages.map((p) => {
          const title = p.templateId === CHAPTER_TITLE_TEMPLATE_ID && p.chapterId && chapterPages.includes(p) ? byChapter.get(p.chapterId) : undefined;
          if (!title) return p;
          titles++;
          return { ...p, slots: withSlotText(p.slots, 'title', title) };
        });
      }
      ctx.progress(Math.min(targets.length, i + batch.length), targets.length);
      // Save after every batch so a failure half-way keeps what was written.
      const latest = this.deps.books.get(book.id);
      if (!latest) throw new Error('Book was deleted');
      this.deps.books.save({ ...latest, pages: mergeSlotTexts(latest.pages, pages) });
    }
    return { captions: written, chapterTitles: titles, skipped };
  }

  /* ---------- Best of burst ---------- */

  private async bursts(ctx: JobContext): Promise<AiJobResult> {
    const { ai, book, images } = ctx;
    const candidates = this.deps.candidates.list(book.id);
    const assets = this.deps.books.assetMap(book.id);
    const clusters = new Map<string, Candidate[]>();
    for (const c of candidates) if (c.clusterId) clusters.set(c.clusterId, [...(clusters.get(c.clusterId) ?? []), c]);
    // Only bursts the engine decided: a user keep/remove anywhere in the burst is respected.
    const eligible = [...clusters.values()]
      .filter((members) => members.length >= MIN_BURST_FRAMES && members.every((m) => m.decision === 'auto-in' || m.decision === 'auto-out') && !members.some((m) => m.reasons.some((r) => r.kind === 'ai')))
      .map((members) => [...members].sort((a, b) => a.clusterRank - b.clusterRank));
    ctx.progress(0, eligible.length);
    let changed = 0;
    for (const [n, members] of eligible.entries()) {
      const imgs: AiImage[] = [];
      for (const [k, m] of members.entries()) {
        const a = assets.get(m.assetId);
        imgs.push({ jpeg: await images.aiThumbnail(m.assetId), label: `Frame ${k + 1}${a?.takenAt ? ` (${a.takenAt.slice(11, 19)})` : ''}` });
      }
      const { data, usage } = await ai.ask({ system: BURST_SYSTEM, text: `${members.length} frames of one burst, in capture order. Which frame is best?`, images: imgs, schema: BurstAnswer, maxTokens: 256 });
      ctx.account(usage);
      const winner = members[0]!;
      const chosen = members[Math.min(members.length - 1, Math.max(0, data.best))]!;
      if (chosen.assetId !== winner.assetId) {
        changed++;
        this.deps.candidates.update(book.id, swapWinner(winner, chosen, data.reason));
      }
      ctx.progress(n + 1, eligible.length);
    }
    return { clusters: eligible.length, changed };
  }

  /** One click undoes a Claude pick: the frames swap back and the `ai` reasons go. */
  revertBurst(bookId: string, assetId: string): Candidate[] {
    const all = this.deps.candidates.map(bookId);
    const one = all.get(assetId);
    const link = one?.reasons.find((r) => r.kind === 'ai' && r.assetId);
    const other = link?.assetId ? all.get(link.assetId) : undefined;
    if (!one || !other) throw new AiServiceError(404, 'This photo has no Claude pick to undo.');
    const [winner, loser] = one.clusterRank === 0 ? [one, other] : [other, one];
    const strip = (c: Candidate): Reason[] => c.reasons.filter((r) => r.kind !== 'ai');
    const updated: Candidate[] = [
      { ...loser, clusterRank: 0, decision: winner.decision, reasons: strip(loser) },
      { ...winner, clusterRank: loser.clusterRank, decision: loser.decision, reasons: strip(winner) },
    ];
    this.deps.candidates.update(bookId, updated);
    return updated;
  }

  /* ---------- Foreword ---------- */

  private async foreword(ctx: JobContext, overwrite: boolean): Promise<AiJobResult> {
    const { ai, book } = ctx;
    const title = book.pages.find((p) => p.templateId === TITLE_TEMPLATE_ID);
    if (!title) throw new AiServiceError(409, 'The book has no title page to put a foreword on.');
    const existing = title.slots.find((s) => s.slotId === 'foreword')?.text;
    if (existing && !overwrite) return { text: existing, skipped: 1 };
    const assets = this.deps.books.assets(book.id);
    const placed = new Set(book.pages.flatMap((p) => p.slots.map((s) => s.assetId).filter(Boolean)));
    const inBook = assets.filter((a) => placed.has(a.id));
    const lo = inBook.map((a) => a.takenAt).filter(Boolean).sort()[0];
    const hi = inBook.map((a) => a.takenAt).filter(Boolean).sort().at(-1);
    const places = [...new Set(inBook.map((a) => placeLabel(a)).filter(Boolean))].slice(0, 12);
    const lines = [`Title: ${book.title}`, ...(book.subtitle ? [`Subtitle: ${book.subtitle}`] : []), `Dates: ${formatIsoRange(lo, hi) || 'unknown'}`, `Photographs: ${placed.size}`, `Places: ${places.join(', ') || 'unknown'}`, ...(book.chapters.length > 0 ? [`Chapters: ${book.chapters.map((c) => c.title).join(', ')}`] : [])];
    ctx.progress(0, 1);
    const { data, usage } = await ai.ask({ system: FOREWORD_SYSTEM, text: lines.join('\n'), schema: ForewordAnswer, maxTokens: 1024 });
    ctx.account(usage);
    const text = data.foreword.trim();
    const latest = this.deps.books.get(book.id);
    if (!latest) throw new Error('Book was deleted');
    this.deps.books.save({ ...latest, pages: latest.pages.map((p) => (p.templateId === TITLE_TEMPLATE_ID ? { ...p, slots: withSlotText(p.slots, 'foreword', text) } : p)) });
    ctx.progress(1, 1);
    return { text };
  }
}

interface JobContext {
  ai: AiClient;
  book: Book;
  images: ImageStore;
  account: (u: { inputTokens: number; outputTokens: number }) => void;
  progress: (done: number, total: number) => void;
  log: FastifyBaseLogger;
}

/** The candidates of a burst after Claude chose `chosen` over the engine's `winner`: ranks and decisions swap, each carries an `ai` reason pointing at the other. */
export function swapWinner(winner: Candidate, chosen: Candidate, reason: string): Candidate[] {
  return [
    { ...chosen, clusterRank: 0, decision: winner.decision, reasons: [{ kind: 'ai', text: `Claude picked this frame of the burst: ${reason}`, assetId: winner.assetId }, ...chosen.reasons] },
    { ...winner, clusterRank: chosen.clusterRank, decision: chosen.decision, reasons: [{ kind: 'ai', text: 'Claude preferred another frame of this burst.', assetId: chosen.assetId }, ...winner.reasons] },
  ];
}

/**
 * Carries the slot texts written by a job onto the book as it is now (the user may have edited
 * pages meanwhile): texts are applied by page id and slot id; everything else stays the user's.
 */
export function mergeSlotTexts(current: readonly Page[], written: readonly Page[]): Page[] {
  const byId = new Map(written.map((p) => [p.id, p]));
  return current.map((p) => {
    const w = byId.get(p.id);
    if (!w) return p;
    let slots = p.slots;
    for (const s of w.slots) {
      const mine = p.slots.find((x) => x.slotId === s.slotId);
      if (s.text !== undefined && (mine?.text === undefined || mine.text === '') && s.text !== mine?.text) slots = withSlotText(slots, s.slotId, s.text);
    }
    return slots === p.slots ? p : { ...p, slots };
  });
}

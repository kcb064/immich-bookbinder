import { Candidate, type BookAsset, type Decision, type Reason, type SelectionSummary } from '@bookbinder/shared';
import { summarize } from '@bookbinder/scoring';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { candidates } from '../db/schema.js';

/** Selection results per book (table candidates). Rows are keyed by (book, asset). */
export class CandidateStore {
  constructor(private readonly db: Db) {}

  list(bookId: string): Candidate[] {
    return this.db
      .select()
      .from(candidates)
      .where(eq(candidates.bookId, bookId))
      .all()
      .map((r) => Candidate.parse(JSON.parse(r.data)));
  }

  map(bookId: string): Map<string, Candidate> {
    return new Map(this.list(bookId).map((c) => [c.assetId, c]));
  }

  count(bookId: string): number {
    return this.db.select({ id: candidates.assetId }).from(candidates).where(eq(candidates.bookId, bookId)).all().length;
  }

  /** Replaces every row of the book. */
  replace(bookId: string, items: readonly Candidate[]): void {
    const updatedAt = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.delete(candidates).where(eq(candidates.bookId, bookId)).run();
      const rows = items.map((c) => ({
        bookId,
        assetId: c.assetId,
        decision: c.decision,
        clusterId: c.clusterId ?? null,
        composite: c.scores.composite,
        data: JSON.stringify(c),
        updatedAt,
      }));
      for (let i = 0; i < rows.length; i += 200) tx.insert(candidates).values(rows.slice(i, i + 200)).run();
    });
  }

  /** The named candidates as stored now (a burst re-read before a job writes it). */
  getMany(bookId: string, assetIds: readonly string[]): Map<string, Candidate> {
    if (assetIds.length === 0) return new Map();
    const rows = this.db
      .select()
      .from(candidates)
      .where(and(eq(candidates.bookId, bookId), inArray(candidates.assetId, [...assetIds])))
      .all();
    return new Map(rows.map((r) => [r.assetId, Candidate.parse(JSON.parse(r.data))]));
  }

  /** Rewrites the given candidates in place (rank, decision, reasons); rows that do not exist are ignored. */
  update(bookId: string, items: readonly Candidate[]): void {
    const updatedAt = new Date().toISOString();
    this.db.transaction((tx) => {
      for (const c of items) {
        tx.update(candidates)
          .set({ decision: c.decision, clusterId: c.clusterId ?? null, composite: c.scores.composite, data: JSON.stringify(c), updatedAt })
          .where(and(eq(candidates.bookId, bookId), eq(candidates.assetId, c.assetId)))
          .run();
      }
    });
  }

  /** Drops rows for photos that are no longer part of the book. */
  prune(bookId: string, keepAssetIds: readonly string[]): number {
    const keep = new Set(keepAssetIds);
    const stale = this.db
      .select({ assetId: candidates.assetId })
      .from(candidates)
      .where(eq(candidates.bookId, bookId))
      .all()
      .map((r) => r.assetId)
      .filter((id) => !keep.has(id));
    for (let i = 0; i < stale.length; i += 400) {
      this.db
        .delete(candidates)
        .where(and(eq(candidates.bookId, bookId), inArray(candidates.assetId, stale.slice(i, i + 400))))
        .run();
    }
    return stale.length;
  }

  delete(bookId: string): void {
    this.db.delete(candidates).where(eq(candidates.bookId, bookId)).run();
  }

  /**
   * Applies user decisions. 'auto' restores the engine's decision. The user reason is kept first in
   * `reasons` so the review page can say "you kept/removed this". Returns the ids that were updated.
   */
  setDecisions(bookId: string, updates: ReadonlyArray<{ assetId: string; decision: 'user-in' | 'user-out' | 'auto' }>): string[] {
    const updatedAt = new Date().toISOString();
    const changed: string[] = [];
    this.db.transaction((tx) => {
      for (const u of updates) {
        const row = tx
          .select()
          .from(candidates)
          .where(and(eq(candidates.bookId, bookId), eq(candidates.assetId, u.assetId)))
          .get();
        if (!row) continue;
        const c = Candidate.parse(JSON.parse(row.data));
        const decision: Decision = u.decision === 'auto' ? c.autoDecision : u.decision;
        const others = c.reasons.filter((r) => r.kind !== 'user-in' && r.kind !== 'user-out');
        const userReason: Reason[] = decision === 'user-in' ? [{ kind: 'user-in', text: 'You kept this photo.' }] : decision === 'user-out' ? [{ kind: 'user-out', text: 'You removed this photo.' }] : [];
        const next: Candidate = { ...c, decision, reasons: [...userReason, ...others] };
        tx.update(candidates)
          .set({ decision, data: JSON.stringify(next), updatedAt })
          .where(and(eq(candidates.bookId, bookId), eq(candidates.assetId, u.assetId)))
          .run();
        changed.push(u.assetId);
      }
    });
    return changed;
  }

  summary(bookId: string, assets: readonly BookAsset[], targetPhotos: number, chapters = 0): SelectionSummary | undefined {
    const list = this.list(bookId);
    if (list.length === 0) return undefined;
    const byId = new Map(list.map((c) => [c.assetId, c]));
    const inputs = assets.filter((a) => byId.has(a.id)).map((a) => ({ asset: a, metrics: byId.get(a.id)!.metrics }));
    return summarize(list, inputs, targetPhotos, chapters);
  }
}

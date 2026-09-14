import type { Reason } from '@bookbinder/shared';

export interface PickItem {
  id: string;
  /** Composite score, 0..1. */
  score: number;
  takenAt?: string | undefined;
  /** City or other place label used for the (weak) place-spread penalty when there are no chapters. */
  place?: string | undefined;
  /** Chapter of the book's plan; chapters get highlight budgets like days do. */
  chapter?: { id: string; title: string } | undefined;
  isFavorite: boolean;
  personIds: readonly string[];
  /** False for burst losers and blurry photos: they are never picked automatically. */
  eligible: boolean;
}

export interface PickOptions {
  target: number;
  /** 0 = pure top-N by score; 1 = spread hard across days, hours, places and chapters. */
  variety: number;
  spreadAcrossDays: boolean;
  includeFavoritesAlways: boolean;
  featuredPersonIds: readonly string[];
  /** Every chapter with eligible photos gets at least this many picks (default 2: an opener and one more). */
  minPerChapter?: number | undefined;
  /** User decisions: always in / always out, whatever the score. */
  forcedIn?: ReadonlySet<string> | undefined;
  forcedOut?: ReadonlySet<string> | undefined;
}

export interface PickDecision {
  picked: boolean;
  reasons: Reason[];
}

export interface PickResult {
  decisions: Map<string, PickDecision>;
  /** Lowest raw score among the photos the greedy pass chose (0 when it chose none). */
  cut: number;
}

export const dayOf = (takenAt: string | undefined): string => (takenAt ? takenAt.slice(0, 10) : 'undated');
const hourOf = (takenAt: string | undefined): string => (takenAt ? takenAt.slice(0, 13) : 'undated');

/** "May 12" for a yyyy-mm-dd key (UTC), "undated photos" otherwise. */
export function dayLabel(day: string): string {
  if (day === 'undated') return 'undated photos';
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const fmt = (score: number): string => (score * 10).toFixed(1);

/** Penalty for a group (day or chapter) that already holds `picks` of its `quota`: gentle below quota, steep above. */
const loadPenalty = (picks: number, quota: number): number => {
  const load = picks / quota;
  return 0.1 * load + 0.4 * Math.max(0, load - 1);
};

/**
 * Greedy diversity picking. Each round takes the eligible photo with the best
 * `score - variety * penalty`, where the penalty grows with how many photos its day and chapter
 * (relative to sqrt-proportional quotas), hour and place already have. Forced-in photos and
 * favourites go first; every chapter and every featured person is guaranteed a presence at the end.
 */
export function pickPhotos(items: readonly PickItem[], opts: PickOptions): PickResult {
  const forcedIn = opts.forcedIn ?? new Set<string>();
  const forcedOut = opts.forcedOut ?? new Set<string>();
  const variety = Math.min(1, Math.max(0, opts.variety));
  const minPerChapter = Math.max(0, opts.minPerChapter ?? 2);
  const decisions = new Map<string, PickDecision>();
  const chosen = new Map<string, PickItem>();
  const byId = new Map(items.map((i) => [i.id, i]));

  const picksDay = new Map<string, number>();
  const picksHour = new Map<string, number>();
  const picksPlace = new Map<string, number>();
  const picksChapter = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, by = 1): void => {
    m.set(k, (m.get(k) ?? 0) + by);
  };
  const choose = (item: PickItem, reasons: Reason[]): void => {
    chosen.set(item.id, item);
    decisions.set(item.id, { picked: true, reasons });
    bump(picksDay, dayOf(item.takenAt));
    bump(picksHour, hourOf(item.takenAt));
    if (item.place) bump(picksPlace, item.place);
    if (item.chapter) bump(picksChapter, item.chapter.id);
  };
  const unchoose = (item: PickItem, reasons: Reason[]): void => {
    chosen.delete(item.id);
    decisions.set(item.id, { picked: false, reasons });
    bump(picksDay, dayOf(item.takenAt), -1);
    bump(picksHour, hourOf(item.takenAt), -1);
    if (item.place) bump(picksPlace, item.place, -1);
    if (item.chapter) bump(picksChapter, item.chapter.id, -1);
  };

  for (const id of forcedIn) {
    const it = byId.get(id);
    if (it && !forcedOut.has(id)) choose(it, [{ kind: 'user-in', text: 'You kept this photo.' }]);
  }
  for (const id of forcedOut) {
    if (byId.has(id) && !decisions.has(id))
      decisions.set(id, { picked: false, reasons: [{ kind: 'user-out', text: 'You removed this photo.' }] });
  }

  let pool = items.filter((i) => i.eligible && !decisions.has(i.id));
  if (opts.includeFavoritesAlways) {
    for (const it of pool)
      if (it.isFavorite) choose(it, [{ kind: 'favorite', text: 'Favourite in Immich, so it is always in.' }]);
    pool = pool.filter((i) => !chosen.has(i.id));
  }

  // Quotas proportional to sqrt(count): a big day (or chapter) still dominates, but small ones get room.
  const eligibleItems = items.filter((it) => it.eligible && !forcedOut.has(it.id));
  const sqrtQuota = (
    keyOf: (it: PickItem) => string | undefined,
    floor: number,
  ): ((key: string) => number) => {
    const counts = new Map<string, number>();
    for (const it of eligibleItems) {
      const k = keyOf(it);
      if (k !== undefined) bump(counts, k);
    }
    let sqrtSum = 0;
    for (const n of counts.values()) sqrtSum += Math.sqrt(n);
    return (key: string): number => {
      const n = counts.get(key) ?? 1;
      return Math.max(floor, (opts.target * Math.sqrt(n)) / Math.max(1e-9, sqrtSum));
    };
  };
  const dayQuota = sqrtQuota((it) => dayOf(it.takenAt), 1);
  const chapterQuota = sqrtQuota((it) => it.chapter?.id, Math.max(1, minPerChapter));
  const hasChapters = items.some((it) => it.chapter);

  const penalty = (it: PickItem): number => {
    let p = 0;
    if (opts.spreadAcrossDays) {
      const day = dayOf(it.takenAt);
      p += loadPenalty(picksDay.get(day) ?? 0, dayQuota(day));
    }
    p += 0.06 * (picksHour.get(hourOf(it.takenAt)) ?? 0);
    if (it.chapter) p += loadPenalty(picksChapter.get(it.chapter.id) ?? 0, chapterQuota(it.chapter.id));
    else if (it.place && !hasChapters) p += 0.02 * (picksPlace.get(it.place) ?? 0);
    return p;
  };

  let cut = 0;
  let greedyPicks = 0;
  while (chosen.size < opts.target && pool.length > 0) {
    let best = -1;
    let bestAdj = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const it = pool[i]!;
      const adj = it.score - variety * penalty(it);
      if (adj > bestAdj) {
        bestAdj = adj;
        best = i;
      }
    }
    const it = pool[best]!;
    pool.splice(best, 1);
    const day = dayOf(it.takenAt);
    const where = it.chapter ? it.chapter.title : dayLabel(day);
    choose(it, [{ kind: 'top-score', text: `Scored ${fmt(it.score)}, among the best for ${where}.` }]);
    cut = greedyPicks === 0 ? it.score : Math.min(cut, it.score);
    greedyPicks++;
  }

  /** The weakest plain pick outside `protect` that can make room for a guarantee; undefined when none. */
  const evict = (protect: (c: PickItem) => boolean, reason: Reason): boolean => {
    const evictable = [...chosen.values()].filter(
      (c) => decisions.get(c.id)?.reasons[0]?.kind === 'top-score' && !protect(c),
    );
    // Take from the most over-quota chapter first, then the lowest score.
    evictable.sort((a, b) => {
      const la = a.chapter ? (picksChapter.get(a.chapter.id) ?? 0) / chapterQuota(a.chapter.id) : 0;
      const lb = b.chapter ? (picksChapter.get(b.chapter.id) ?? 0) / chapterQuota(b.chapter.id) : 0;
      return lb - la || a.score - b.score;
    });
    const victim = evictable[0];
    if (!victim) return false;
    unchoose(victim, [reason]);
    return true;
  };

  // Every chapter with eligible photos keeps at least minPerChapter picks (an opener needs a hero).
  if (hasChapters && minPerChapter > 0) {
    const chapterIds = [
      ...new Set(eligibleItems.map((it) => it.chapter?.id).filter((id): id is string => Boolean(id))),
    ];
    for (const chapterId of chapterIds) {
      while ((picksChapter.get(chapterId) ?? 0) < minPerChapter) {
        let cand: PickItem | undefined;
        for (const it of pool)
          if (it.chapter?.id === chapterId && (!cand || it.score > cand.score)) cand = it;
        if (!cand) break;
        if (chosen.size >= opts.target) {
          const ok = evict(
            (c) =>
              c.chapter?.id === chapterId ||
              (c.chapter !== undefined && (picksChapter.get(c.chapter.id) ?? 0) <= minPerChapter),
            { kind: 'variety', text: 'Swapped out so every chapter has enough photos for its opener.' },
          );
          if (!ok) break;
        }
        pool = pool.filter((p) => p.id !== cand!.id);
        choose(cand, [
          { kind: 'chapter', text: `Best of ${cand.chapter!.title}, kept so the chapter has its opener.` },
        ]);
      }
    }
  }

  // Every featured person appears at least once when any eligible photo shows them.
  for (const pid of opts.featuredPersonIds) {
    if ([...chosen.values()].some((c) => c.personIds.includes(pid))) continue;
    let cand: PickItem | undefined;
    for (const it of pool) if (it.personIds.includes(pid) && (!cand || it.score > cand.score)) cand = it;
    if (!cand) continue;
    if (chosen.size >= opts.target) {
      const ok = evict((c) => opts.featuredPersonIds.some((f) => c.personIds.includes(f)), {
        kind: 'variety',
        text: 'Swapped out so every featured person appears at least once.',
      });
      if (!ok) continue;
    }
    pool = pool.filter((p) => p.id !== cand!.id);
    choose(cand, [
      { kind: 'featured-person', text: 'Best photo of a featured person who would otherwise be missing.' },
    ]);
  }

  for (const it of pool) {
    const day = dayOf(it.takenAt);
    if (greedyPicks > 0 && it.score >= cut && variety > 0) {
      const text = it.chapter
        ? `Scored ${fmt(it.score)}, but ${it.chapter.title} already has ${picksChapter.get(it.chapter.id) ?? 0} of about ${Math.round(chapterQuota(it.chapter.id))} highlights; kept for variety.`
        : `Scored ${fmt(it.score)}, but ${dayLabel(day)} already has ${picksDay.get(day) ?? 0} picks; kept for variety.`;
      decisions.set(it.id, { picked: false, reasons: [{ kind: 'variety', text }] });
    } else {
      decisions.set(it.id, {
        picked: false,
        reasons: [
          { kind: 'below-cut', text: `Scored ${fmt(it.score)}; the cut for this book was ${fmt(cut)}.` },
        ],
      });
    }
  }

  return { decisions, cut };
}

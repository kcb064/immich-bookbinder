import type { Reason } from '@bookbinder/shared';

export interface PickItem {
  id: string;
  /** Composite score, 0..1. */
  score: number;
  takenAt?: string | undefined;
  /** City or other place label used for the (weak) place-spread penalty. */
  place?: string | undefined;
  isFavorite: boolean;
  personIds: readonly string[];
  /** False for burst losers and blurry photos: they are never picked automatically. */
  eligible: boolean;
}

export interface PickOptions {
  target: number;
  /** 0 = pure top-N by score; 1 = spread hard across days, hours and places. */
  variety: number;
  spreadAcrossDays: boolean;
  includeFavoritesAlways: boolean;
  featuredPersonIds: readonly string[];
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

/**
 * Greedy diversity picking. Each round takes the eligible photo with the best
 * `score - variety * penalty`, where the penalty grows with how many photos its day (relative to a
 * sqrt-proportional day quota), hour and place already have. Forced-in photos and favourites go
 * first; featured people are guaranteed at least one appearance at the end.
 */
export function pickPhotos(items: readonly PickItem[], opts: PickOptions): PickResult {
  const forcedIn = opts.forcedIn ?? new Set<string>();
  const forcedOut = opts.forcedOut ?? new Set<string>();
  const variety = Math.min(1, Math.max(0, opts.variety));
  const decisions = new Map<string, PickDecision>();
  const chosen = new Map<string, PickItem>();
  const byId = new Map(items.map((i) => [i.id, i]));

  const picksDay = new Map<string, number>();
  const picksHour = new Map<string, number>();
  const picksPlace = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string): void => {
    m.set(k, (m.get(k) ?? 0) + 1);
  };
  const choose = (item: PickItem, reasons: Reason[]): void => {
    chosen.set(item.id, item);
    decisions.set(item.id, { picked: true, reasons });
    bump(picksDay, dayOf(item.takenAt));
    bump(picksHour, hourOf(item.takenAt));
    if (item.place) bump(picksPlace, item.place);
  };

  for (const id of forcedIn) {
    const it = byId.get(id);
    if (it && !forcedOut.has(id)) choose(it, [{ kind: 'user-in', text: 'You kept this photo.' }]);
  }
  for (const id of forcedOut) {
    if (byId.has(id) && !decisions.has(id)) decisions.set(id, { picked: false, reasons: [{ kind: 'user-out', text: 'You removed this photo.' }] });
  }

  let pool = items.filter((i) => i.eligible && !decisions.has(i.id));
  if (opts.includeFavoritesAlways) {
    for (const it of pool) if (it.isFavorite) choose(it, [{ kind: 'favorite', text: 'Favourite in Immich, so it is always in.' }]);
    pool = pool.filter((i) => !chosen.has(i.id));
  }

  // Day quotas: proportional to sqrt(count) so a big day still dominates, but small days get room.
  const dayCounts = new Map<string, number>();
  for (const it of items) if (it.eligible && !forcedOut.has(it.id)) bump(dayCounts, dayOf(it.takenAt));
  let sqrtSum = 0;
  for (const n of dayCounts.values()) sqrtSum += Math.sqrt(n);
  const quota = (day: string): number => {
    const n = dayCounts.get(day) ?? 1;
    return Math.max(1, (opts.target * Math.sqrt(n)) / Math.max(1e-9, sqrtSum));
  };
  const penalty = (it: PickItem): number => {
    const day = dayOf(it.takenAt);
    let p = 0;
    if (opts.spreadAcrossDays) {
      const load = (picksDay.get(day) ?? 0) / quota(day);
      p += 0.1 * load + 0.4 * Math.max(0, load - 1);
    }
    p += 0.06 * (picksHour.get(hourOf(it.takenAt)) ?? 0);
    if (it.place) p += 0.02 * (picksPlace.get(it.place) ?? 0);
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
    choose(it, [{ kind: 'top-score', text: `Scored ${fmt(it.score)}, among the best for ${dayLabel(day)}.` }]);
    cut = greedyPicks === 0 ? it.score : Math.min(cut, it.score);
    greedyPicks++;
  }

  // Every featured person appears at least once when any eligible photo shows them.
  for (const pid of opts.featuredPersonIds) {
    if ([...chosen.values()].some((c) => c.personIds.includes(pid))) continue;
    let cand: PickItem | undefined;
    for (const it of pool) if (it.personIds.includes(pid) && (!cand || it.score > cand.score)) cand = it;
    if (!cand) continue;
    if (chosen.size >= opts.target) {
      const evictable = [...chosen.values()].filter((c) => decisions.get(c.id)?.reasons[0]?.kind === 'top-score' && !opts.featuredPersonIds.some((f) => c.personIds.includes(f)));
      evictable.sort((a, b) => a.score - b.score);
      const victim = evictable[0];
      if (!victim) continue;
      chosen.delete(victim.id);
      decisions.set(victim.id, { picked: false, reasons: [{ kind: 'variety', text: 'Swapped out so every featured person appears at least once.' }] });
    }
    pool = pool.filter((p) => p.id !== cand!.id);
    choose(cand, [{ kind: 'featured-person', text: 'Best photo of a featured person who would otherwise be missing.' }]);
  }

  for (const it of pool) {
    const day = dayOf(it.takenAt);
    if (greedyPicks > 0 && it.score >= cut && variety > 0) {
      decisions.set(it.id, {
        picked: false,
        reasons: [{ kind: 'variety', text: `Scored ${fmt(it.score)}, but ${dayLabel(day)} already has ${picksDay.get(day) ?? 0} picks; kept for variety.` }],
      });
    } else {
      decisions.set(it.id, { picked: false, reasons: [{ kind: 'below-cut', text: `Scored ${fmt(it.score)}; the cut for this book was ${fmt(cut)}.` }] });
    }
  }

  return { decisions, cut };
}

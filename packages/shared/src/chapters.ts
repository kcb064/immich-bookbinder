import { z } from 'zod';

/*
 * Chapter planning (M3). Pure and deterministic so the selection engine (per-chapter budgets), the
 * paginator (chapter openers) and the review page all agree on the same chapters for a book.
 */

export const ChapterMode = z.enum(['auto', 'places', 'days', 'none']);
export type ChapterMode = z.infer<typeof ChapterMode>;

/** What the planner needs to know about a photo (a subset of BookAsset). */
export interface ChapterPhoto {
  id: string;
  takenAt?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  country?: string | undefined;
  lat?: number | undefined;
  lon?: number | undefined;
}

export interface ChapterPlan {
  id: string;
  /** Place name for place chapters ("Lisbon"), "Day 3" / "Days 3–4" for day chapters. */
  title: string;
  /** Date range, plus the country when the book spans several, or the dominant place for day chapters. */
  subtitle: string;
  /** The place label the chapter was built around (absent for day chapters). */
  place?: string;
  country?: string;
  startsAt?: string;
  endsAt?: string;
  /** Chronological. */
  photoIds: string[];
}

export interface ChapterOptions {
  mode: ChapterMode;
  /** The book's page target; caps the chapter count so openers do not eat the book. */
  targetPages: number;
  /** Photos in a run below this share of the book merge into a neighbour (default 3%). */
  minShare?: number | undefined;
}

/** Most chapters a book of `targetPages` gets: one per 8 pages, between 1 and 12. */
export function maxChaptersFor(targetPages: number): number {
  return Math.max(1, Math.min(12, Math.floor(targetPages / 8)));
}

/** Books with fewer photos than this never get chapters. */
export const MIN_PHOTOS_FOR_CHAPTERS = 6;

export const dayKeyOf = (takenAt: string | undefined): string | undefined =>
  takenAt ? takenAt.slice(0, 10) : undefined;

const EARTH_KM = 6371;
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface GeoCluster<T> {
  lat: number;
  lon: number;
  items: T[];
}

/**
 * Greedy single-pass clustering: each point joins the first cluster whose running centroid is within
 * `radiusKm`, else starts one. Good enough for "which town was this" at 25–40 km; O(n × clusters).
 */
export function clusterByDistance<T>(
  items: readonly T[],
  coords: (item: T) => [lat: number, lon: number],
  radiusKm: number,
): GeoCluster<T>[] {
  const clusters: GeoCluster<T>[] = [];
  for (const item of items) {
    const [lat, lon] = coords(item);
    let best: GeoCluster<T> | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const c of clusters) {
      const d = haversineKm(lat, lon, c.lat, c.lon);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best && bestD <= radiusKm) {
      const n = best.items.length;
      best.lat = (best.lat * n + lat) / (n + 1);
      best.lon = (best.lon * n + lon) / (n + 1);
      best.items.push(item);
    } else {
      clusters.push({ lat, lon, items: [item] });
    }
  }
  return clusters;
}

const hasCoords = (p: ChapterPhoto): p is ChapterPhoto & { lat: number; lon: number } =>
  typeof p.lat === 'number' && typeof p.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon);

const clean = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

/**
 * Place label per photo: city, else region, else a geo cluster named after the nearest city seen in
 * the book (within 80 km), else the country, else rounded coordinates. Undefined when nothing is known.
 */
export function placeKeys(photos: readonly ChapterPhoto[]): Map<string, string> {
  const keys = new Map<string, string>();
  const named = photos.filter((p) => clean(p.city) && hasCoords(p)) as Array<
    ChapterPhoto & { lat: number; lon: number }
  >;
  const unnamed: Array<ChapterPhoto & { lat: number; lon: number }> = [];
  for (const p of photos) {
    const city = clean(p.city);
    const state = clean(p.state);
    if (city) keys.set(p.id, city);
    else if (state) keys.set(p.id, state);
    else if (hasCoords(p)) unnamed.push(p);
    else if (clean(p.country)) keys.set(p.id, clean(p.country)!);
  }
  if (unnamed.length > 0) {
    const cityClusters = clusterByDistance(named, (p) => [p.lat, p.lon], 30);
    for (const cluster of clusterByDistance(unnamed, (p) => [p.lat, p.lon], 40)) {
      let label: string | undefined;
      let bestD = 80;
      for (const c of cityClusters) {
        const d = haversineKm(cluster.lat, cluster.lon, c.lat, c.lon);
        if (d < bestD) {
          bestD = d;
          label = clean(c.items[0]!.city);
        }
      }
      if (!label) {
        const country = cluster.items.map((p) => clean(p.country)).find(Boolean);
        label = country
          ? `Somewhere in ${country}`
          : `${cluster.lat.toFixed(2)}°, ${cluster.lon.toFixed(2)}°`;
      }
      for (const p of cluster.items) keys.set(p.id, label);
    }
  }
  return keys;
}

interface Run {
  key: string;
  photos: ChapterPhoto[];
}

function buildRuns(sorted: readonly ChapterPhoto[], keyOf: (p: ChapterPhoto) => string | undefined): Run[] {
  const runs: Run[] = [];
  let pending: ChapterPhoto[] = [];
  for (const p of sorted) {
    const key = keyOf(p);
    const current = runs[runs.length - 1];
    if (key === undefined) {
      // Unknown place/date: rides along with the current run, or waits for the first real one.
      if (current) current.photos.push(p);
      else pending.push(p);
      continue;
    }
    if (current && current.key === key) current.photos.push(p);
    else {
      runs.push({ key, photos: [...pending, p] });
      pending = [];
    }
  }
  if (pending.length > 0) {
    const last = runs[runs.length - 1];
    if (last) last.photos.push(...pending);
  }
  return runs;
}

/** Merges runs that are too small or too many; the merged run takes the key with the most photos. */
function mergeRuns(
  runs: Run[],
  keyOf: (p: ChapterPhoto) => string | undefined,
  minRun: number,
  maxRuns: number,
): Run[] {
  const out = runs.map((r) => ({ key: r.key, photos: [...r.photos] }));
  const dominant = (photos: readonly ChapterPhoto[], fallback: string): string => {
    const counts = new Map<string, number>();
    for (const p of photos) {
      const k = keyOf(p);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let best = fallback;
    let bestN = -1;
    for (const [k, n] of counts) {
      if (n > bestN) {
        bestN = n;
        best = k;
      }
    }
    return best;
  };
  for (;;) {
    if (out.length <= 1) break;
    let smallest = 0;
    for (let i = 1; i < out.length; i++)
      if (out[i]!.photos.length < out[smallest]!.photos.length) smallest = i;
    if (out[smallest]!.photos.length >= minRun && out.length <= maxRuns) break;
    const prev = out[smallest - 1];
    const next = out[smallest + 1];
    const victim = out[smallest]!;
    // Prefer the neighbour with the same key (a short detour inside one place), else the smaller one.
    let into: Run;
    if (prev && prev.key === victim.key) into = prev;
    else if (next && next.key === victim.key) into = next;
    else if (prev && next) into = prev.photos.length <= next.photos.length ? prev : next;
    else into = (prev ?? next)!;
    if (into === prev) into.photos.push(...victim.photos);
    else into.photos.unshift(...victim.photos);
    into.key = dominant(into.photos, into.key);
    out.splice(smallest, 1);
    // A merge can leave two neighbours with the same key (Lisbon, detour, Lisbon): join them.
    for (let i = out.length - 1; i > 0; i--) {
      if (out[i]!.key === out[i - 1]!.key) {
        out[i - 1]!.photos.push(...out[i]!.photos);
        out.splice(i, 1);
      }
    }
  }
  return out;
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});
const monthFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });

function parseIso(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "May 12 – 21, 2026", "May 12, 2026" for one day, "" when unknown. Dates are read in UTC. */
export function formatIsoRange(lo: string | undefined, hi: string | undefined): string {
  const a = parseIso(lo);
  const b = parseIso(hi);
  if (!a || !b) return a || b ? dateFmt.format((a ?? b)!) : '';
  const [s, e] = a <= b ? [a, b] : [b, a];
  if (s.toISOString().slice(0, 10) === e.toISOString().slice(0, 10)) return dateFmt.format(s);
  if (s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth()) {
    return `${monthFmt.format(s).split(' ')[0]} ${s.getUTCDate()} – ${e.getUTCDate()}, ${s.getUTCFullYear()}`;
  }
  // Intl puts thin spaces around the dash; plain spaces survive every font.
  return dateFmt.formatRange(s, e).replace(/[  ]/g, ' ');
}

/** Earliest and latest capture time among the photos, as ISO strings. */
export function dateSpan(photos: Iterable<Pick<ChapterPhoto, 'takenAt'>>): {
  startsAt?: string;
  endsAt?: string;
} {
  let lo: string | undefined;
  let hi: string | undefined;
  for (const p of photos) {
    if (!p.takenAt) continue;
    if (!lo || p.takenAt < lo) lo = p.takenAt;
    if (!hi || p.takenAt > hi) hi = p.takenAt;
  }
  return { ...(lo ? { startsAt: lo } : {}), ...(hi ? { endsAt: hi } : {}) };
}

/** Chronological copy: by capture time, undated photos last, ties by id. */
export function chronological<T extends Pick<ChapterPhoto, 'id' | 'takenAt'>>(photos: readonly T[]): T[] {
  return [...photos].sort((a, b) => {
    const ta = a.takenAt ?? '￿';
    const tb = b.takenAt ?? '￿';
    return ta < tb ? -1 : ta > tb ? 1 : a.id.localeCompare(b.id);
  });
}

function mode<T extends string>(values: Iterable<T | undefined>): T | undefined {
  const counts = new Map<T, number>();
  let total = 0;
  for (const v of values) {
    if (v === undefined) continue;
    total++;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | undefined;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return total > 0 ? best : undefined;
}

/**
 * Splits a book's photos into chapters.
 *
 * - `places` (and `auto`): maximal chronological runs of one place (city, else region, else a geo
 *   cluster, else country). Runs shorter than 3% of the book (at least 3 photos) merge into a
 *   neighbour, and the count is capped at one chapter per 8 target pages. A book that is one place
 *   from start to end gets no chapters.
 * - `days`: runs of calendar days, merged the same way; titles read "Day 3" / "Days 3–4".
 * - `none`: no chapters.
 *
 * Returns [] whenever a single chapter would result; the title page then carries the book.
 */
export function planChapters(photos: readonly ChapterPhoto[], opts: ChapterOptions): ChapterPlan[] {
  if (opts.mode === 'none' || photos.length < MIN_PHOTOS_FOR_CHAPTERS) return [];
  const sorted = chronological(photos);
  const n = sorted.length;
  const minRun = Math.max(3, Math.ceil((opts.minShare ?? 0.03) * n));
  const maxRuns = maxChaptersFor(opts.targetPages);
  const places = placeKeys(sorted);
  const byDay = (p: ChapterPhoto): string | undefined => dayKeyOf(p.takenAt);
  const byPlace = (p: ChapterPhoto): string | undefined => places.get(p.id);
  const keyOf = opts.mode === 'days' ? byDay : byPlace;

  const runs = mergeRuns(buildRuns(sorted, keyOf), keyOf, minRun, maxRuns);
  if (runs.length < 2) return [];

  const countries = new Set(sorted.map((p) => clean(p.country)).filter(Boolean));
  const firstDay = sorted.map((p) => dayKeyOf(p.takenAt)).find(Boolean);
  const dayNumber = (day: string): number => {
    if (!firstDay) return 1;
    const ms =
      Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) -
      Date.UTC(Number(firstDay.slice(0, 4)), Number(firstDay.slice(5, 7)) - 1, Number(firstDay.slice(8, 10)));
    return Math.round(ms / 86_400_000) + 1;
  };

  return runs.map((run, i) => {
    const span = dateSpan(run.photos);
    const range = formatIsoRange(span.startsAt, span.endsAt);
    const country = mode(run.photos.map((p) => clean(p.country)));
    if (opts.mode === 'days') {
      const days = [...new Set(run.photos.map(byDay).filter((d): d is string => Boolean(d)))].sort();
      const first = days[0];
      const last = days[days.length - 1];
      const title = !first
        ? 'Undated'
        : first === last
          ? `Day ${dayNumber(first)}`
          : `Days ${dayNumber(first)}–${dayNumber(last!)}`;
      const place = mode(run.photos.map(byPlace));
      return {
        id: `ch${i + 1}`,
        title,
        subtitle: [range, place].filter(Boolean).join(' · '),
        ...(place ? { place } : {}),
        ...(country ? { country } : {}),
        ...span,
        photoIds: run.photos.map((p) => p.id),
      };
    }
    return {
      id: `ch${i + 1}`,
      title: run.key,
      subtitle: [range, countries.size > 1 ? country : undefined].filter(Boolean).join(' · '),
      place: run.key,
      ...(country ? { country } : {}),
      ...span,
      photoIds: run.photos.map((p) => p.id),
    };
  });
}

/** Chapter id per photo for a plan. */
export function chapterIndex(plan: readonly ChapterPlan[]): Map<string, ChapterPlan> {
  const out = new Map<string, ChapterPlan>();
  for (const c of plan) for (const id of c.photoIds) out.set(id, c);
  return out;
}

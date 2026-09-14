import { clusterByDistance, haversineKm, type BBox } from '@bookbinder/shared';
import type { ImmichClient } from './client.js';

/*
 * Trip detection (M3): where was the camera away from home, and when? Geotagged photos come from
 * Immich's timeline buckets (one call per month, columnar, `withCoordinates`), so a two-year scan
 * is about 24 small requests and no per-asset fetches.
 */

export interface GeoPoint {
  id: string;
  /** UTC capture time as Immich reports it. */
  takenAt: string;
  /** Calendar day where the photo was taken (fileCreatedAt shifted by localOffsetHours). */
  localDay: string;
  lat: number;
  lon: number;
  city?: string | undefined;
  country?: string | undefined;
}

export interface TripPlaceSuggestion {
  name: string;
  bbox: BBox;
  /** Geotagged photos in this place during the trip. */
  count: number;
}

export interface TripSuggestion {
  id: string;
  /** "Lisbon, Sintra & Porto" */
  title: string;
  /** YYYY-MM-DD, inclusive. */
  start: string;
  end: string;
  /** Calendar days with photos away from home. */
  days: number;
  /** Geotagged photos only; the trip source also picks up ungeotagged photos in the range. */
  photoCount: number;
  places: TripPlaceSuggestion[];
  country?: string | undefined;
}

export interface DetectOptions {
  /** A day counts as "away" when most of its photos are farther than this from home (default 60 km). */
  homeRadiusKm?: number;
  /** Places within a trip are grouped at this radius (default 25 km). */
  placeKm?: number;
  /** Shortest trip, in away days (default 2); a single day still counts with `minPhotosSingleDay`. */
  minDays?: number;
  minPhotosSingleDay?: number;
  /** Photo-less days a trip may span (default 2). */
  maxGapDays?: number;
}

const DAY_MS = 86_400_000;

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Month buckets Immich would list for the range, as YYYY-MM-01 (the timeline bucket key). */
export function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur <= to) {
    out.push(`${cur.toISOString().slice(0, 7)}-01`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

/** Every geotagged, non-trashed image in [from, to], read month by month from the timeline. */
export async function fetchGeoPoints(client: ImmichClient, from: Date, to: Date): Promise<GeoPoint[]> {
  const wanted = new Set(monthsBetween(from, to).map(monthKey));
  const buckets = await client.getTimeBuckets({ withCoordinates: true, visibility: 'timeline' });
  const out: GeoPoint[] = [];
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  for (const b of buckets) {
    if (!wanted.has(monthKey(b.timeBucket)) || b.count === 0) continue;
    const t = await client.getTimeBucket(b.timeBucket, { withCoordinates: true, visibility: 'timeline' });
    for (let i = 0; i < t.id.length; i++) {
      const lat = t.latitude?.[i];
      const lon = t.longitude?.[i];
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      if (t.isTrashed[i] || t.isImage[i] === false) continue;
      const takenAt = t.fileCreatedAt[i]!;
      if (takenAt < fromIso || takenAt > toIso) continue;
      const offset = t.localOffsetHours[i] ?? 0;
      const local = new Date(new Date(takenAt).getTime() + offset * 3_600_000);
      const city = t.city?.[i];
      const country = t.country?.[i];
      out.push({
        id: t.id[i]!,
        takenAt,
        localDay: local.toISOString().slice(0, 10),
        lat,
        lon,
        ...(city ? { city } : {}),
        ...(country ? { country } : {}),
      });
    }
  }
  return out;
}

function dayIndex(day: string): number {
  return Math.round(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS,
  );
}

function mostCommon(values: Iterable<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

/** "Lisbon, Sintra & Porto" or "Lisbon, Sintra & 3 more places". */
export function tripTitle(places: readonly TripPlaceSuggestion[]): string {
  const names = places.map((p) => p.name);
  if (names.length === 0) return 'Trip';
  if (names.length === 1) return names[0]!;
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} & ${names.length - 2} more places`;
}

/** Home is the cluster seen on the most distinct days; trips are runs of days spent mostly elsewhere. */
export function detectTrips(points: readonly GeoPoint[], opts: DetectOptions = {}): TripSuggestion[] {
  const homeRadiusKm = opts.homeRadiusKm ?? 60;
  const placeKm = opts.placeKm ?? 25;
  const minDays = opts.minDays ?? 2;
  const minPhotosSingleDay = opts.minPhotosSingleDay ?? 30;
  const maxGapDays = opts.maxGapDays ?? 2;
  if (points.length === 0) return [];

  const clusters = clusterByDistance(points, (p) => [p.lat, p.lon], 30);
  let home = clusters[0]!;
  let homeDays = -1;
  for (const c of clusters) {
    const days = new Set(c.items.map((p) => p.localDay)).size;
    if (days > homeDays || (days === homeDays && c.items.length > home.items.length)) {
      home = c;
      homeDays = days;
    }
  }
  const away = (p: GeoPoint): boolean => haversineKm(p.lat, p.lon, home.lat, home.lon) > homeRadiusKm;

  const byDay = new Map<string, GeoPoint[]>();
  for (const p of points) {
    const list = byDay.get(p.localDay);
    if (list) list.push(p);
    else byDay.set(p.localDay, [p]);
  }
  const days = [...byDay.keys()].sort();

  const runs: string[][] = [];
  let current: string[] | undefined;
  let lastDay: string | undefined;
  for (const day of days) {
    const pts = byDay.get(day)!;
    const isAway = pts.filter(away).length >= Math.ceil(pts.length * 0.6);
    if (isAway) {
      if (current && lastDay && dayIndex(day) - dayIndex(lastDay) - 1 <= maxGapDays) current.push(day);
      else {
        current = [day];
        runs.push(current);
      }
    } else current = undefined;
    lastDay = day;
  }

  const trips: TripSuggestion[] = [];
  for (const run of runs) {
    const pts = run.flatMap((d) => byDay.get(d)!.filter(away));
    if (run.length < minDays && pts.length < minPhotosSingleDay) continue;
    const places: TripPlaceSuggestion[] = clusterByDistance(pts, (p) => [p.lat, p.lon], placeKm)
      .map((c) => {
        let west = 180;
        let east = -180;
        let south = 90;
        let north = -90;
        for (const p of c.items) {
          west = Math.min(west, p.lon);
          east = Math.max(east, p.lon);
          south = Math.min(south, p.lat);
          north = Math.max(north, p.lat);
        }
        const pad = 0.03; // about 3 km: the town, not just the exact spots
        const name =
          mostCommon(c.items.map((p) => p.city)) ??
          mostCommon(c.items.map((p) => p.country)) ??
          `${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°`;
        return {
          name,
          bbox: [round4(west - pad), round4(south - pad), round4(east + pad), round4(north + pad)] as BBox,
          count: c.items.length,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const start = run[0]!;
    const end = run[run.length - 1]!;
    const countryCounts = new Map<string, number>();
    for (const p of pts) if (p.country) countryCounts.set(p.country, (countryCounts.get(p.country) ?? 0) + 1);
    const topCountry = [...countryCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const country = topCountry && topCountry[1] >= pts.length * 0.8 ? topCountry[0] : undefined;
    trips.push({
      id: `${start}_${end}`,
      title: tripTitle(places),
      start,
      end,
      days: run.length,
      photoCount: pts.length,
      places,
      ...(country ? { country } : {}),
    });
  }
  return trips.sort((a, b) => b.start.localeCompare(a.start));
}

function round4(v: number): number {
  return Math.round(Math.max(-180, Math.min(180, v)) * 10000) / 10000;
}

/** Inclusive ISO datetimes that cover a suggestion's days end to end (UTC, with a day of slack for time zones). */
export function tripDateRange(start: string, end: string): { takenAfter: string; takenBefore: string } {
  return {
    takenAfter: new Date(dayIndex(start) * DAY_MS - DAY_MS / 2).toISOString(),
    takenBefore: new Date((dayIndex(end) + 1) * DAY_MS + DAY_MS / 2).toISOString(),
  };
}

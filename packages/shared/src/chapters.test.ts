import { describe, expect, it } from 'vitest';
import {
  chapterIndex,
  clusterByDistance,
  formatIsoRange,
  haversineKm,
  maxChaptersFor,
  placeKeys,
  planChapters,
  type ChapterPhoto,
} from './chapters.js';
import { targetPhotosFor } from './book.js';

const LISBON = { lat: 38.72, lon: -9.14 };
const SINTRA = { lat: 38.8, lon: -9.39 };
const PORTO = { lat: 41.15, lon: -8.61 };

/** `count` photos per stop, one every 20 minutes, stops in order. */
function trip(
  stops: Array<{
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lon?: number;
    count: number;
    day: number;
  }>,
): ChapterPhoto[] {
  const out: ChapterPhoto[] = [];
  let n = 0;
  for (const s of stops) {
    const { count, day, ...rest } = s;
    for (let i = 0; i < count; i++) {
      out.push({
        id: `p${n++}`,
        takenAt: new Date(Date.UTC(2026, 4, 12 + day, 9, i * 20)).toISOString(),
        ...rest,
      });
    }
  }
  return out;
}

describe('geo helpers', () => {
  it('measures distances and clusters nearby points', () => {
    expect(Math.round(haversineKm(LISBON.lat, LISBON.lon, PORTO.lat, PORTO.lon))).toBeGreaterThan(250);
    expect(haversineKm(LISBON.lat, LISBON.lon, LISBON.lat, LISBON.lon)).toBe(0);
    const pts = [LISBON, { lat: 38.73, lon: -9.15 }, PORTO, SINTRA];
    const clusters = clusterByDistance(pts, (p) => [p.lat, p.lon], 30);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.items).toHaveLength(3);
  });

  it('formats ranges in UTC', () => {
    expect(formatIsoRange('2026-05-12T10:00:00Z', '2026-05-21T10:00:00Z')).toBe('May 12 – 21, 2026');
    expect(formatIsoRange('2026-05-12T10:00:00Z', '2026-05-12T23:00:00Z')).toBe('May 12, 2026');
    expect(formatIsoRange('2026-05-30T10:00:00Z', '2026-06-02T10:00:00Z')).toBe('May 30 – June 2, 2026');
    expect(formatIsoRange(undefined, undefined)).toBe('');
    expect(formatIsoRange('2026-05-12T10:00:00Z', undefined)).toBe('May 12, 2026');
  });

  it('caps chapters by page target and reserves opener pages in the photo target', () => {
    expect(maxChaptersFor(48)).toBe(6);
    expect(maxChaptersFor(24)).toBe(3);
    expect(maxChaptersFor(200)).toBe(12);
    expect(targetPhotosFor(48)).toBe(129);
    // Three chapters: six opener pages fewer body pages, plus three hero photos.
    expect(targetPhotosFor(48, 3)).toBe(Math.round(40 * 2.8) + 3);
  });
});

describe('placeKeys', () => {
  it('uses city, then region, then a geo cluster named after the nearest city, then country', () => {
    const photos: ChapterPhoto[] = [
      { id: 'a', city: 'Lisbon', ...LISBON },
      { id: 'b', state: 'Lisboa' },
      { id: 'c', lat: 38.75, lon: -9.2 },
      { id: 'd', lat: 45.5, lon: 10.2, country: 'Italy' },
      { id: 'e', lat: -33.9, lon: 151.2 },
      { id: 'f', country: 'Spain' },
      { id: 'g' },
    ];
    const keys = placeKeys(photos);
    expect(keys.get('a')).toBe('Lisbon');
    expect(keys.get('b')).toBe('Lisboa');
    expect(keys.get('c')).toBe('Lisbon');
    expect(keys.get('d')).toBe('Somewhere in Italy');
    expect(keys.get('e')).toBe('-33.90°, 151.20°');
    expect(keys.get('f')).toBe('Spain');
    expect(keys.has('g')).toBe(false);
  });
});

describe('planChapters', () => {
  it('makes one chapter per place run with date-range subtitles', () => {
    const photos = trip([
      { city: 'Lisbon', country: 'Portugal', count: 30, day: 0 },
      { city: 'Lisbon', country: 'Portugal', count: 20, day: 1 },
      { city: 'Sintra', country: 'Portugal', count: 25, day: 2 },
      { city: 'Porto', country: 'Portugal', count: 40, day: 3 },
      { city: 'Porto', country: 'Portugal', count: 10, day: 4 },
    ]);
    const plan = planChapters(photos, { mode: 'auto', targetPages: 48 });
    expect(plan.map((c) => c.title)).toEqual(['Lisbon', 'Sintra', 'Porto']);
    expect(plan[0]!.subtitle).toBe('May 12 – 13, 2026');
    expect(plan[1]!.subtitle).toBe('May 14, 2026');
    expect(plan[2]).toMatchObject({ id: 'ch3', place: 'Porto', country: 'Portugal' });
    expect(plan.flatMap((c) => c.photoIds)).toHaveLength(photos.length);
    expect(chapterIndex(plan).get('p60')?.title).toBe('Sintra');
    // Chronology inside chapters and across them.
    const order = plan.flatMap((c) => c.photoIds).map((id) => Number(id.slice(1)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('merges a short detour into the surrounding place and notes the country when several appear', () => {
    const photos = trip([
      { city: 'Lisbon', country: 'Portugal', count: 40, day: 0 },
      { city: 'Cascais', country: 'Portugal', count: 2, day: 0 },
      { city: 'Lisbon', country: 'Portugal', count: 30, day: 1 },
      { city: 'Seville', country: 'Spain', count: 30, day: 2 },
    ]);
    const plan = planChapters(photos, { mode: 'places', targetPages: 48 });
    expect(plan.map((c) => c.title)).toEqual(['Lisbon', 'Seville']);
    expect(plan[0]!.photoIds).toHaveLength(72);
    expect(plan[1]!.subtitle).toBe('May 14, 2026 · Spain');
  });

  it('caps the number of chapters for small books by merging the smallest runs', () => {
    const photos = trip(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((city, i) => ({ city, count: 10 + i, day: i })),
    );
    const plan = planChapters(photos, { mode: 'places', targetPages: 24 });
    expect(plan.length).toBeLessThanOrEqual(3);
    expect(plan.flatMap((c) => c.photoIds)).toHaveLength(photos.length);
  });

  it('returns no chapters for a single place, a tiny book or mode none', () => {
    const one = trip([
      { city: 'Lisbon', count: 50, day: 0 },
      { city: 'Lisbon', count: 50, day: 3 },
    ]);
    expect(planChapters(one, { mode: 'auto', targetPages: 48 })).toEqual([]);
    expect(
      planChapters(
        trip([
          { city: 'A', count: 2, day: 0 },
          { city: 'B', count: 2, day: 1 },
        ]),
        { mode: 'auto', targetPages: 48 },
      ),
    ).toEqual([]);
    const two = trip([
      { city: 'A', count: 20, day: 0 },
      { city: 'B', count: 20, day: 1 },
    ]);
    expect(planChapters(two, { mode: 'none', targetPages: 48 })).toEqual([]);
    expect(planChapters(two, { mode: 'auto', targetPages: 48 })).toHaveLength(2);
  });

  it('splits by day on request, numbering days from the first', () => {
    const photos = trip([
      { city: 'Lisbon', count: 20, day: 0 },
      { city: 'Lisbon', count: 20, day: 1 },
      { city: 'Lisbon', count: 2, day: 2 },
      { city: 'Sintra', count: 20, day: 4 },
    ]);
    const plan = planChapters(photos, { mode: 'days', targetPages: 48 });
    expect(plan.map((c) => c.title)).toEqual(['Day 1', 'Days 2–3', 'Day 5']);
    expect(plan[2]!.subtitle).toBe('May 16, 2026 · Sintra');
  });

  it('carries photos without a place along with the current run and lets geo clusters name themselves', () => {
    const photos = trip([
      { city: 'Lisbon', ...LISBON, count: 20, day: 0 },
      { count: 3, day: 0 },
      { lat: 41.16, lon: -8.6, count: 20, day: 1 },
      { city: 'Porto', ...PORTO, count: 5, day: 2 },
    ]);
    const plan = planChapters(photos, { mode: 'auto', targetPages: 48 });
    expect(plan.map((c) => [c.title, c.photoIds.length])).toEqual([
      ['Lisbon', 23],
      ['Porto', 25],
    ]);
  });
});

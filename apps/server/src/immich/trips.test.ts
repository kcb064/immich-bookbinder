import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImmichClient } from './client.js';
import {
  detectTrips,
  fetchGeoPoints,
  monthsBetween,
  tripDateRange,
  tripTitle,
  type GeoPoint,
} from './trips.js';
import { FAKE_PLACES, startFakeImmich, type FakeImmich } from '../test/fake-immich.js';

function point(
  id: string,
  day: string,
  place: { lat: number; lon: number; city: string; country: string },
  jitter = 0,
): GeoPoint {
  return {
    id,
    takenAt: `${day}T12:00:00.000Z`,
    localDay: day,
    lat: place.lat + jitter,
    lon: place.lon + jitter,
    city: place.city,
    country: place.country,
  };
}

describe('detectTrips', () => {
  const home = FAKE_PLACES['Austin']!;
  const lisbon = FAKE_PLACES['Lisbon']!;
  const porto = FAKE_PLACES['Porto']!;

  it('finds runs of away days, names the places and ignores a single quiet day away', () => {
    const points: GeoPoint[] = [];
    for (let d = 1; d <= 28; d++)
      points.push(point(`h${d}`, `2026-04-${String(d).padStart(2, '0')}`, home, d / 5000));
    for (let d = 12; d <= 15; d++)
      for (let k = 0; k < 6; k++) points.push(point(`l${d}${k}`, `2026-05-${d}`, lisbon, k / 3000));
    for (let d = 16; d <= 18; d++)
      for (let k = 0; k < 4; k++) points.push(point(`p${d}${k}`, `2026-05-${d}`, porto, k / 3000));
    points.push(point('day-trip', '2026-06-20', porto));
    const trips = detectTrips(points);
    expect(trips).toHaveLength(1);
    const t = trips[0]!;
    expect(t).toMatchObject({
      start: '2026-05-12',
      end: '2026-05-18',
      days: 7,
      photoCount: 36,
      country: 'Portugal',
    });
    expect(t.title).toBe('Lisbon & Porto');
    expect(t.places.map((p) => [p.name, p.count])).toEqual([
      ['Lisbon', 24],
      ['Porto', 12],
    ]);
    const box = t.places[0]!.bbox;
    expect(box[0]).toBeLessThan(lisbon.lon);
    expect(box[2]).toBeGreaterThan(lisbon.lon);
    expect(box[1]).toBeLessThan(lisbon.lat);
    expect(box[3]).toBeGreaterThan(lisbon.lat);
  });

  it('bridges photo-less days inside a trip but not a day back home', () => {
    const points: GeoPoint[] = [];
    for (let d = 1; d <= 20; d++) points.push(point(`h${d}`, `2026-03-${String(d).padStart(2, '0')}`, home));
    points.push(
      point('a', '2026-03-22', lisbon),
      point('b', '2026-03-23', lisbon),
      point('c', '2026-03-26', lisbon),
      point('d', '2026-03-27', lisbon),
    );
    points.push(point('home', '2026-03-28', home));
    points.push(point('e', '2026-03-29', porto), point('f', '2026-03-30', porto));
    const trips = detectTrips(points);
    expect(trips.map((t) => [t.start, t.end])).toEqual([
      ['2026-03-29', '2026-03-30'],
      ['2026-03-22', '2026-03-27'],
    ]);
  });

  it('handles no points, titles, month ranges and date ranges', () => {
    expect(detectTrips([])).toEqual([]);
    expect(tripTitle([])).toBe('Trip');
    expect(tripTitle([{ name: 'A', bbox: [0, 0, 1, 1], count: 1 }])).toBe('A');
    expect(
      tripTitle(
        ['A', 'B', 'C', 'D', 'E'].map((name) => ({
          name,
          bbox: [0, 0, 1, 1] as [number, number, number, number],
          count: 1,
        })),
      ),
    ).toBe('A, B & 3 more places');
    expect(monthsBetween(new Date('2025-11-15T00:00:00Z'), new Date('2026-02-03T00:00:00Z'))).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
    const r = tripDateRange('2026-05-12', '2026-05-18');
    expect(r.takenAfter < '2026-05-12T00:00:00.000Z').toBe(true);
    expect(r.takenBefore > '2026-05-18T23:59:59.000Z').toBe(true);
  });
});

describe('fetchGeoPoints against the fake Immich', () => {
  let immich: FakeImmich;
  beforeAll(async () => {
    immich = await startFakeImmich({ photos: 48, homePhotos: 40 });
  });
  afterAll(async () => {
    await immich.close();
  });

  it('reads geotagged photos month by month and detects the Portugal trip and the New Orleans weekend', async () => {
    const client = createImmichClient({ url: immich.url, apiKey: 'test-api-key-1234' });
    const points = await fetchGeoPoints(
      client,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-06-30T23:59:59Z'),
    );
    expect(points.length).toBe(immich.assets.filter((a) => a.lat !== undefined).length);
    expect(immich.requests.filter((r) => r.path === '/api/timeline/bucket').length).toBeGreaterThanOrEqual(3);
    const trips = detectTrips(points);
    expect(trips.length).toBe(2);
    expect(trips[0]).toMatchObject({ start: '2026-05-12', country: 'Portugal' });
    // Sintra is 24 km from Lisbon, inside the 25 km place radius, so it folds into Lisbon.
    expect(trips[0]!.places.map((p) => p.name)).toEqual(['Lisbon', 'Porto', 'Pinhão']);
    expect(trips[0]!.places[0]!.count).toBeGreaterThan(trips[0]!.places[1]!.count);
    expect(trips[1]).toMatchObject({ start: '2026-03-14', end: '2026-03-15', title: 'New Orleans' });
  });
});

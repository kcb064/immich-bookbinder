import { SelectionRules } from '@bookbinder/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImmichClient, type ImmichAsset } from './client.js';
import { gatherAssets, inBBox, toBookAsset } from './gather.js';
import { startFakeImmich, type FakeImmich } from '../test/fake-immich.js';

describe('toBookAsset', () => {
  const base = {
    id: 'a1',
    type: 'IMAGE',
    isTrashed: false,
    isFavorite: true,
    visibility: 'timeline',
    fileCreatedAt: '2026-05-12T10:00:00.000Z',
    originalFileName: 'IMG_1.HEIC',
    width: 4032,
    height: 3024,
    exifInfo: {
      exifImageWidth: 4032,
      exifImageHeight: 3024,
      orientation: '1',
      dateTimeOriginal: '2026-05-12T09:58:00.000Z',
      city: ' Lisbon ',
      state: 'Lisboa',
      country: 'Portugal',
      latitude: 38.72,
      longitude: -9.14,
      description: '',
    },
  } as unknown as ImmichAsset;

  it('maps the EXIF subset and trims empty strings', () => {
    expect(toBookAsset(base)).toEqual({
      id: 'a1',
      takenAt: '2026-05-12T09:58:00.000Z',
      width: 4032,
      height: 3024,
      ratio: 4032 / 3024,
      city: 'Lisbon',
      state: 'Lisboa',
      country: 'Portugal',
      lat: 38.72,
      lon: -9.14,
      isFavorite: true,
      people: [],
      fileName: 'IMG_1.HEIC',
    });
  });

  it('drops null or zero coordinates', () => {
    const noGps = { ...base, exifInfo: { ...base.exifInfo, latitude: null, longitude: null } } as ImmichAsset;
    expect(toBookAsset(noGps)?.lat).toBeUndefined();
    const nullIsland = { ...base, exifInfo: { ...base.exifInfo, latitude: 0, longitude: 0 } } as ImmichAsset;
    expect(toBookAsset(nullIsland)?.lon).toBeUndefined();
  });

  it('swaps dimensions for rotated EXIF orientations', () => {
    const rotated = { ...base, exifInfo: { ...base.exifInfo, orientation: '6' } } as ImmichAsset;
    expect(toBookAsset(rotated)).toMatchObject({ width: 3024, height: 4032, ratio: 3024 / 4032 });
  });

  it('skips videos, trashed, archived and non-primary stack members', () => {
    expect(toBookAsset({ ...base, type: 'VIDEO' } as ImmichAsset)).toBeUndefined();
    expect(toBookAsset({ ...base, isTrashed: true } as ImmichAsset)).toBeUndefined();
    expect(toBookAsset({ ...base, visibility: 'archive' } as ImmichAsset)).toBeUndefined();
    expect(
      toBookAsset({ ...base, stack: { id: 's', primaryAssetId: 'other', assetCount: 2 } } as ImmichAsset),
    ).toBeUndefined();
    expect(
      toBookAsset({ ...base, stack: { id: 's', primaryAssetId: 'a1', assetCount: 2 } } as ImmichAsset),
    ).toBeDefined();
  });

  it('falls back to fileCreatedAt and asset dimensions without EXIF', () => {
    const bare = { ...base, exifInfo: undefined } as unknown as ImmichAsset;
    expect(toBookAsset(bare)).toMatchObject({ takenAt: '2026-05-12T10:00:00.000Z', ratio: 4032 / 3024 });
    const none = { ...bare, width: null, height: null } as ImmichAsset;
    expect(toBookAsset(none)?.ratio).toBe(1.5);
  });
});

describe('gatherAssets against the fake Immich', () => {
  let immich: FakeImmich;
  const rules = (sources: unknown[]): SelectionRules => SelectionRules.parse({ sources, targetPages: 24 });
  beforeAll(async () => {
    immich = await startFakeImmich({ photos: 30, homePhotos: 20 });
  });
  afterAll(async () => {
    await immich.close();
  });

  it('unions albums, de-duplicates and sorts chronologically', async () => {
    const client = createImmichClient({ url: immich.url, apiKey: 'test-api-key-1234' });
    const { assets, warnings } = await gatherAssets(
      client,
      rules([
        { kind: 'album', albumIds: ['album-best'] },
        { kind: 'album', albumIds: ['album-trip'] },
      ]),
    );
    expect(assets).toHaveLength(30);
    expect(new Set(assets.map((a) => a.id)).size).toBe(30);
    for (let i = 1; i < assets.length; i++) expect(assets[i]!.takenAt! >= assets[i - 1]!.takenAt!).toBe(true);
    expect(assets[0]).toMatchObject({
      city: 'Lisbon',
      state: 'Lisboa',
      country: 'Portugal',
      fileName: 'IMG_4000.JPG',
      lat: expect.any(Number),
      lon: expect.any(Number),
    });
    // Every sixth trip photo carries no GPS.
    expect(assets.find((a) => a.id === 'asset-0005')!.lat).toBeUndefined();
    expect(warnings).toEqual([]);
    // 30 photos at 10 per page for the trip album plus one page for the best-of album: the cursor was followed.
    expect(immich.requests.filter((r) => r.path === '/api/search/metadata').length).toBeGreaterThanOrEqual(4);
  });

  it('gathers a trip by date range and places, keeping ungeotagged photos when asked', async () => {
    const client = createImmichClient({ url: immich.url, apiKey: 'test-api-key-1234' });
    const range = { takenAfter: '2026-05-12T00:00:00.000Z', takenBefore: '2026-05-14T23:59:59.000Z' };
    const anywhere = await gatherAssets(client, rules([{ kind: 'trip', ...range }]));
    expect(anywhere.assets.length).toBe(
      immich.assets.filter((a) => a.takenAt >= range.takenAfter && a.takenAt <= range.takenBefore).length,
    );
    const lisbon = { name: 'Lisbon', bbox: [-9.3, 38.6, -9.0, 38.85] as [number, number, number, number] };
    const inLisbon = await gatherAssets(
      client,
      rules([{ kind: 'trip', ...range, places: [lisbon], includeUngeotagged: false }]),
    );
    expect(inLisbon.assets.length).toBeGreaterThan(0);
    expect(inLisbon.assets.every((a) => a.city === 'Lisbon')).toBe(true);
    expect(inLisbon.warnings[0]).toMatch(/taken outside the trip/);
    const withUngeotagged = await gatherAssets(
      client,
      rules([{ kind: 'trip', ...range, places: [lisbon], includeUngeotagged: true }]),
    );
    expect(withUngeotagged.assets.length).toBeGreaterThan(inLisbon.assets.length);
    expect(withUngeotagged.assets.some((a) => a.lat === undefined)).toBe(true);
  });

  it('gathers people as a union and smart search up to its limit', async () => {
    const client = createImmichClient({ url: immich.url, apiKey: 'test-api-key-1234' });
    const people = await gatherAssets(
      client,
      rules([{ kind: 'people', personIds: ['person-kevin', 'person-sam'] }]),
    );
    const expected = immich.assets.filter((a) =>
      a.people?.some((p) => p.id === 'person-kevin' || p.id === 'person-sam'),
    );
    expect(people.assets.map((a) => a.id).sort()).toEqual(expected.map((a) => a.id).sort());
    expect(people.assets.every((a) => a.people.length > 0)).toBe(true);

    const smart = await gatherAssets(
      client,
      rules([{ kind: 'smart', query: 'Portugal riverside', limit: 10 }]),
    );
    expect(smart.assets.length).toBe(10);
    expect(smart.assets.every((a) => a.country === 'Portugal')).toBe(true);
    expect(smart.warnings[0]).toMatch(/stopped at its limit/);
    expect(immich.requests.some((r) => r.path === '/api/search/smart')).toBe(true);
  });

  it('reports favorites and an empty result', async () => {
    const client = createImmichClient({ url: immich.url, apiKey: 'test-api-key-1234' });
    const fav = await gatherAssets(client, rules([{ kind: 'favorites' }]));
    expect(fav.assets.length).toBe(immich.assets.filter((a) => a.isFavorite).length);
    const empty = await gatherAssets(client, rules([{ kind: 'album', albumIds: ['album-empty'] }]));
    expect(empty.assets).toEqual([]);
    expect(empty.warnings).toContain('No photos were found for these sources.');
  });

  it('tests bounding boxes, including ones that cross the antimeridian', () => {
    expect(inBBox(38.7, -9.1, [-9.3, 38.6, -9.0, 38.85])).toBe(true);
    expect(inBBox(41.1, -8.6, [-9.3, 38.6, -9.0, 38.85])).toBe(false);
    expect(inBBox(-17.5, 179.5, [178, -19, -179, -16])).toBe(true);
    expect(inBBox(-17.5, -179.5, [178, -19, -179, -16])).toBe(true);
    expect(inBBox(-17.5, 0, [178, -19, -179, -16])).toBe(false);
  });
});

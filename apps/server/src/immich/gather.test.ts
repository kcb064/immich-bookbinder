import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImmichClient, type ImmichAsset } from './client.js';
import { gatherAssets, toBookAsset } from './gather.js';
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
    exifInfo: { exifImageWidth: 4032, exifImageHeight: 3024, orientation: '1', dateTimeOriginal: '2026-05-12T09:58:00.000Z', city: ' Lisbon ', country: 'Portugal', description: '' },
  } as unknown as ImmichAsset;

  it('maps the EXIF subset and trims empty strings', () => {
    expect(toBookAsset(base)).toEqual({
      id: 'a1',
      takenAt: '2026-05-12T09:58:00.000Z',
      width: 4032,
      height: 3024,
      ratio: 4032 / 3024,
      city: 'Lisbon',
      country: 'Portugal',
      isFavorite: true,
      fileName: 'IMG_1.HEIC',
    });
  });

  it('swaps dimensions for rotated EXIF orientations', () => {
    const rotated = { ...base, exifInfo: { ...base.exifInfo, orientation: '6' } } as ImmichAsset;
    expect(toBookAsset(rotated)).toMatchObject({ width: 3024, height: 4032, ratio: 3024 / 4032 });
  });

  it('skips videos, trashed, archived and non-primary stack members', () => {
    expect(toBookAsset({ ...base, type: 'VIDEO' } as ImmichAsset)).toBeUndefined();
    expect(toBookAsset({ ...base, isTrashed: true } as ImmichAsset)).toBeUndefined();
    expect(toBookAsset({ ...base, visibility: 'archive' } as ImmichAsset)).toBeUndefined();
    expect(toBookAsset({ ...base, stack: { id: 's', primaryAssetId: 'other', assetCount: 2 } } as ImmichAsset)).toBeUndefined();
    expect(toBookAsset({ ...base, stack: { id: 's', primaryAssetId: 'a1', assetCount: 2 } } as ImmichAsset)).toBeDefined();
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
  beforeAll(async () => {
    immich = await startFakeImmich({ photos: 30 });
  });
  afterAll(async () => {
    await immich.close();
  });

  it('unions albums, de-duplicates and sorts chronologically', async () => {
    const client = createImmichClient({ url: immich.url, apiKey: 'test-api-key-1234' });
    const { assets, warnings } = await gatherAssets(client, {
      sources: [
        { kind: 'album', albumIds: ['album-best'] },
        { kind: 'album', albumIds: ['album-trip'] },
        { kind: 'smart', query: 'dogs' },
      ],
      featuredPersonIds: [],
      includeFavoritesAlways: true,
      collapseNearDuplicates: true,
      skipBlurry: true,
      spreadAcrossDays: true,
      includeVideoStills: false,
      targetPages: 24,
      weights: { sharpness: 0.7, people: 0.6, aesthetic: 0.45, variety: 0.8 },
    });
    expect(assets).toHaveLength(30);
    expect(new Set(assets.map((a) => a.id)).size).toBe(30);
    for (let i = 1; i < assets.length; i++) expect(assets[i]!.takenAt! >= assets[i - 1]!.takenAt!).toBe(true);
    expect(assets[0]).toMatchObject({ city: 'Lisbon', country: 'Portugal', fileName: 'IMG_4000.JPG' });
    expect(warnings).toEqual(['Source "smart" is not supported yet (planned for M3); it was skipped.']);
    // 30 photos at 10 per page for the trip album plus one page for the best-of album: the cursor was followed.
    expect(immich.requests.filter((r) => r.path === '/api/search/metadata').length).toBeGreaterThanOrEqual(4);
  });

  it('reports favorites and an empty result', async () => {
    const client = createImmichClient({ url: immich.url, apiKey: 'test-api-key-1234' });
    const fav = await gatherAssets(client, { sources: [{ kind: 'favorites' }] } as never);
    expect(fav.assets.length).toBe(immich.assets.filter((a) => a.isFavorite).length);
    const empty = await gatherAssets(client, { sources: [{ kind: 'album', albumIds: ['album-empty'] }] } as never);
    expect(empty.assets).toEqual([]);
    expect(empty.warnings).toContain('No photos were found for these sources.');
  });
});

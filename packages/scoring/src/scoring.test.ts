import { SelectionRules, type BookAsset } from '@bookbinder/shared';
import { describe, expect, it } from 'vitest';
import { clusterNearDuplicates } from './cluster.js';
import { analyzeImage, boxDownsample, colorfulness, laplacianVariance, lumaStats, thirdsEnergy, toGray, type RawImage } from './metrics.js';
import { hamming, phashFrom32 } from './phash.js';
import { dayOf, pickPhotos, type PickItem } from './pick.js';
import { aestheticScore, compositeScore, exposureScore, isBlurry, peopleScore, sharpnessScore } from './score.js';
import { buildSelection, type SelectionInput } from './select.js';

/* ---------- synthetic images ---------- */

function image(width: number, height: number, px: (x: number, y: number) => [number, number, number]): RawImage {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = px(x, y);
      const p = (y * width + x) * 3;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
    }
  }
  return { data, width, height, channels: 3 };
}

const flat = (v: number) => image(64, 64, () => [v, v, v]);
const checker = image(64, 64, (x, y) => ((x + y) % 2 === 0 ? [255, 255, 255] : [0, 0, 0]));
const gradient = image(64, 64, (x) => [x * 4, x * 4, x * 4]);
/** A soft blob (a "subject") centred at (cx, cy) in fractions of the frame, on a plain ground. */
function scene(cx: number, cy: number, w = 128, h = 96): RawImage {
  return image(w, h, (x, y) => {
    const dx = (x / w - cx) * 3;
    const dy = (y / h - cy) * 3;
    const d = Math.sqrt(dx * dx + dy * dy);
    const v = d < 0.09 ? 40 : 200;
    return [v, v + 10, v - 10];
  });
}
const gray32 = (img: RawImage) => boxDownsample(toGray(img), img.width, img.height, 32, 32);

describe('metrics', () => {
  it('luma, clipping and stdev', () => {
    expect(lumaStats(toGray(flat(128)))).toEqual({ mean: 128, stdev: 0, clipDark: 0, clipBright: 0 });
    const s = lumaStats(toGray(checker));
    expect(s.mean).toBeCloseTo(127.5, 0);
    expect(s.clipDark).toBeCloseTo(0.5, 2);
    expect(s.clipBright).toBeCloseTo(0.5, 2);
    expect(s.stdev).toBeGreaterThan(120);
  });

  it('laplacian variance is zero for flat and gradient images and high for a checkerboard', () => {
    expect(laplacianVariance(toGray(flat(90)), 64, 64)).toBe(0);
    expect(laplacianVariance(toGray(gradient), 64, 64)).toBeLessThan(1);
    expect(laplacianVariance(toGray(checker), 64, 64)).toBeGreaterThan(10_000);
  });

  it('colourfulness is zero for grey and high for saturated stripes', () => {
    expect(colorfulness(flat(100))).toBe(0);
    const stripes = image(64, 64, (x) => (x % 2 ? [255, 0, 0] : [0, 0, 255]));
    expect(colorfulness(stripes)).toBeGreaterThan(100);
  });

  it('thirds energy is about a quarter for uniform texture and high for a subject on a thirds point', () => {
    const noise = image(96, 96, (x, y) => {
      const v = ((x * 7919 + y * 104729) % 97) * 2;
      return [v, v, v];
    });
    expect(thirdsEnergy(toGray(noise), 96, 96)).toBeGreaterThan(0.18);
    expect(thirdsEnergy(toGray(noise), 96, 96)).toBeLessThan(0.32);
    const onThird = scene(1 / 3, 1 / 3);
    const centred = scene(0.5, 0.5);
    expect(thirdsEnergy(toGray(onThird), 128, 96)).toBeGreaterThan(0.6);
    expect(thirdsEnergy(toGray(centred), 128, 96)).toBeLessThan(0.3);
  });

  it('analyzeImage returns every metric and a 16-hex hash', () => {
    const a = analyzeImage(scene(1 / 3, 0.4));
    expect(a.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.laplacianVar).toBeGreaterThan(0);
    expect(a.meanLuma).toBeGreaterThan(100);
    expect(a.thirds).toBeGreaterThan(0);
  });
});

describe('phash', () => {
  it('is identical for the same picture and close for a slightly moved one', () => {
    const a = phashFrom32(gray32(scene(0.4, 0.5)));
    const b = phashFrom32(gray32(scene(0.4, 0.5)));
    const moved = phashFrom32(gray32(scene(0.43, 0.52)));
    const other = phashFrom32(gray32(scene(0.8, 0.2)));
    const mirrored = phashFrom32(gray32(image(64, 64, (x) => [x * 4, 255 - x * 4, 128])));
    expect(hamming(a, b)).toBe(0);
    expect(hamming(a, moved)).toBeLessThanOrEqual(10);
    expect(hamming(a, other)).toBeGreaterThan(12);
    expect(hamming(a, mirrored)).toBeGreaterThan(12);
  });

  it('hamming counts differing bits', () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hamming('0000000000000001', '0000000000000003')).toBe(1);
    expect(() => hamming('00', '000')).toThrow();
  });
});

describe('scores', () => {
  it('sharpness maps the log of laplacian variance', () => {
    expect(sharpnessScore(0)).toBe(0);
    expect(sharpnessScore(99)).toBeCloseTo(0.5, 2);
    expect(sharpnessScore(5000)).toBe(1);
  });

  it('exposure rewards mid-grey with contrast and punishes clipping', () => {
    const good = exposureScore({ meanLuma: 120, stdevLuma: 60, clipDark: 0.01, clipBright: 0.01 });
    const dark = exposureScore({ meanLuma: 30, stdevLuma: 20, clipDark: 0.3, clipBright: 0 });
    const flatGrey = exposureScore({ meanLuma: 120, stdevLuma: 5, clipDark: 0, clipBright: 0 });
    expect(good).toBeGreaterThan(0.9);
    expect(dark).toBeLessThan(0.3);
    expect(flatGrey).toBeLessThan(good);
  });

  it('aesthetic likes colour, tonal range and thirds placement', () => {
    const base = { laplacianVar: 500, meanLuma: 120, stdevLuma: 55, clipDark: 0, clipBright: 0, colorfulness: 60, thirds: 0.5 };
    expect(aestheticScore(base)).toBeGreaterThan(0.8);
    expect(aestheticScore({ ...base, colorfulness: 0, thirds: 0.2, stdevLuma: 15 })).toBeLessThan(0.35);
  });

  it('people score is neutral without people and rises with featured people and big central faces', () => {
    const none = peopleScore({ people: [], featuredPersonIds: new Set() });
    const named = peopleScore({ people: [{ id: 'p1', name: 'Kevin' }], featuredPersonIds: new Set() });
    const featured = peopleScore({ people: [{ id: 'p1', name: 'Kevin' }], featuredPersonIds: new Set(['p1']) });
    const portrait = peopleScore({ people: [{ id: 'p1', name: 'Kevin' }], faces: [{ x: 0.35, y: 0.25, w: 0.3, h: 0.4, personId: 'p1' }], featuredPersonIds: new Set(['p1']) });
    const tiny = peopleScore({ people: [{ id: 'p1', name: 'Kevin' }], faces: [{ x: 0.9, y: 0.05, w: 0.03, h: 0.04, personId: 'p1' }], featuredPersonIds: new Set(['p1']) });
    expect(none).toBeCloseTo(0.45, 5);
    expect(named).toBeGreaterThan(none);
    expect(featured).toBeGreaterThan(named);
    expect(portrait).toBeGreaterThan(featured);
    expect(tiny).toBeLessThan(featured);
  });

  it('composite follows the weights and favourites get a bonus', () => {
    const s = { sharpness: 1, exposure: 1, aesthetic: 0, people: 0 };
    expect(compositeScore(s, { sharpness: 1, people: 0, aesthetic: 0, variety: 0.5 })).toBe(1);
    expect(compositeScore(s, { sharpness: 0, people: 1, aesthetic: 0, variety: 0.5 })).toBe(0);
    const w = SelectionRules.parse({ sources: [{ kind: 'favorites' }] }).weights;
    expect(compositeScore(s, w, { isFavorite: true })).toBeCloseTo(compositeScore(s, w) + 0.08, 5);
  });

  it('blurry needs both a low absolute score and a big gap to the median', () => {
    expect(isBlurry(10, 400)).toBe(true);
    expect(isBlurry(10, 30)).toBe(false);
    expect(isBlurry(200, 4000)).toBe(false);
  });
});

describe('clusterNearDuplicates', () => {
  const H0 = '0000000000000000';
  const H8 = '00000000000000ff'; // 8 bits from H0
  const H32 = '00000000ffffffff';
  const at = (s: number) => new Date(Date.UTC(2026, 4, 12, 10, 0, s)).toISOString();

  it('groups close hashes taken within a burst and keeps distant ones apart', () => {
    const groups = clusterNearDuplicates([
      { id: 'a', takenAt: at(0), phash: H0 },
      { id: 'b', takenAt: at(20), phash: H8 },
      { id: 'c', takenAt: at(3600), phash: '000000000000ff00' }, // 8 bits from a, 16 from b, an hour later
      { id: 'd', takenAt: at(40), phash: H32 },
    ]);
    expect([...groups.entries()]).toEqual([['a', ['a', 'b']]]);
  });

  it('identical hashes cluster whatever the gap; Immich duplicate groups always cluster', () => {
    const groups = clusterNearDuplicates([
      { id: 'a', takenAt: at(0), phash: H0 },
      { id: 'b', takenAt: at(7200), phash: H0 },
      { id: 'x', phash: H32, duplicateId: 'dup-1' },
      { id: 'y', takenAt: at(99999), phash: H8, duplicateId: 'dup-1' },
    ]);
    expect(groups.get('a')).toEqual(['a', 'b']);
    expect(groups.get('x')).toEqual(['x', 'y']);
    expect(groups.size).toBe(2);
  });

  it('respects the lookback window', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, takenAt: at(i), phash: i === 0 || i === 29 ? H0 : H32 }));
    expect(clusterNearDuplicates(items, { lookback: 5 }).size).toBe(1); // the 28 H32 photos cluster, p00 and p29 are too far apart
    expect(clusterNearDuplicates(items, { lookback: 40 }).size).toBe(2);
  });
});

describe('pickPhotos', () => {
  const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 4, day, hour, minute)).toISOString();
  const item = (id: string, score: number, takenAt: string, extra: Partial<PickItem> = {}): PickItem => ({
    id,
    score,
    takenAt,
    isFavorite: false,
    personIds: [],
    eligible: true,
    ...extra,
  });
  // Day 12 has 20 strong photos, days 13 and 14 have 5 weaker each.
  const items = [
    ...Array.from({ length: 20 }, (_, i) => item(`a${i}`, 0.9 - i * 0.005, at(12, 8 + Math.floor(i / 4), (i % 4) * 10))),
    ...Array.from({ length: 5 }, (_, i) => item(`b${i}`, 0.7 - i * 0.02, at(13, 9 + i))),
    ...Array.from({ length: 5 }, (_, i) => item(`c${i}`, 0.65 - i * 0.02, at(14, 9 + i))),
  ];
  const base = { target: 12, variety: 0.8, spreadAcrossDays: true, includeFavoritesAlways: true, featuredPersonIds: [] as string[] };

  const pickedIds = (r: ReturnType<typeof pickPhotos>) => [...r.decisions.entries()].filter(([, d]) => d.picked).map(([id]) => id);

  it('with variety 0 takes the top scores; with variety it spreads across days', () => {
    const top = pickPhotos(items, { ...base, variety: 0 });
    expect(pickedIds(top).every((id) => id.startsWith('a'))).toBe(true);
    expect(pickedIds(top)).toHaveLength(12);

    const spread = pickPhotos(items, base);
    const ids = pickedIds(spread);
    expect(ids).toHaveLength(12);
    const days = new Set(ids.map((id) => dayOf(items.find((i) => i.id === id)!.takenAt)));
    expect(days.size).toBe(3);
    expect(ids.filter((id) => id.startsWith('a')).length).toBeGreaterThanOrEqual(5);
    const skipped = spread.decisions.get('a19');
    expect(skipped?.picked).toBe(false);
    expect(['variety', 'below-cut']).toContain(skipped?.reasons[0]?.kind);
  });

  it('honours forced decisions, favourites and ineligible photos', () => {
    const withFlags = items.map((i) => (i.id === 'c4' ? { ...i, isFavorite: true } : i.id === 'a0' ? { ...i, eligible: false } : i));
    const r = pickPhotos(withFlags, { ...base, forcedIn: new Set(['c3']), forcedOut: new Set(['a1']) });
    const ids = pickedIds(r);
    expect(ids).toContain('c3');
    expect(ids).toContain('c4');
    expect(ids).not.toContain('a1');
    expect(ids).not.toContain('a0');
    expect(r.decisions.get('c3')?.reasons[0]?.kind).toBe('user-in');
    expect(r.decisions.get('c4')?.reasons[0]?.kind).toBe('favorite');
    expect(r.decisions.get('a1')?.reasons[0]?.kind).toBe('user-out');
    expect(r.decisions.has('a0')).toBe(false);
    expect(ids).toHaveLength(12);
  });

  it('guarantees a featured person by swapping out the weakest pick', () => {
    const withPerson = items.map((i) => (i.id === 'c4' ? { ...i, personIds: ['grandma'], score: 0.2 } : i));
    const r = pickPhotos(withPerson, { ...base, featuredPersonIds: ['grandma'] });
    const ids = pickedIds(r);
    expect(ids).toContain('c4');
    expect(ids).toHaveLength(12);
    expect(r.decisions.get('c4')?.reasons[0]?.kind).toBe('featured-person');
    expect([...r.decisions.values()].some((d) => !d.picked && d.reasons[0]?.kind === 'variety' && d.reasons[0].text.includes('featured'))).toBe(true);
  });
});

describe('buildSelection', () => {
  const rules = SelectionRules.parse({ sources: [{ kind: 'album', albumIds: ['x'] }], targetPages: 24 });
  const asset = (id: string, takenAt: string, extra: Partial<BookAsset> = {}): BookAsset => ({ id, takenAt, ratio: 1.5, isFavorite: false, people: [], ...extra });
  const metrics = (laplacianVar: number) => ({ laplacianVar, meanLuma: 120, stdevLuma: 50, clipDark: 0.01, clipBright: 0.01, colorfulness: 40, thirds: 0.3 });
  const at = (m: number, s = 0) => new Date(Date.UTC(2026, 4, 12, 10, m, s)).toISOString();
  const H = (n: number) => n.toString(16).padStart(16, '0');
  /** Pairwise Hamming distance of at least 32 bits, so nothing here clusters by hash. */
  const DISTINCT = ['aaaaaaaaaaaaaaaa', '5555555555555555', 'ff00ff00ff00ff00', '00ff00ff00ff00ff', 'f0f0f0f0f0f0f0f0', '0f0f0f0f0f0f0f0f', 'cccccccccccccccc', '3333333333333333', 'a5a5a5a5a5a5a5a5', '5a5a5a5a5a5a5a5a'];

  const inputs: SelectionInput[] = [
    // A burst of three within 20 s with near-identical hashes; the middle one is sharpest.
    { asset: asset('burst-1', at(0, 0)), metrics: metrics(300), phash: H(0) },
    { asset: asset('burst-2', at(0, 8)), metrics: metrics(900), phash: H(1) },
    { asset: asset('burst-3', at(0, 16)), metrics: metrics(400), phash: H(3) },
    // A blurry one
    { asset: asset('blurry', at(5)), metrics: metrics(4), phash: H(0xffff0000) },
    // Regular photos
    ...Array.from({ length: 10 }, (_, i) => ({ asset: asset(`p${i}`, at(10 + i)), metrics: metrics(500 + i * 50), phash: DISTINCT[i]! })),
    // Not analysed
    { asset: asset('missing', at(40)) },
  ];

  it('collapses the burst, skips the blurry photo and explains every decision', () => {
    const r = buildSelection(inputs, { rules, targetPhotos: 6 });
    const byId = new Map(r.candidates.map((c) => [c.assetId, c]));
    expect(byId.get('burst-2')).toMatchObject({ clusterId: 'burst-1', clusterRank: 0, clusterSize: 3, decision: 'auto-in' });
    expect(byId.get('burst-1')).toMatchObject({ clusterId: 'burst-1', clusterRank: expect.any(Number), decision: 'auto-out' });
    expect(byId.get('burst-1')!.clusterRank).toBeGreaterThan(0);
    expect(byId.get('burst-1')!.reasons[0]).toMatchObject({ kind: 'duplicate', assetId: 'burst-2' });
    expect(byId.get('burst-2')!.reasons.some((x) => x.kind === 'best-of-burst')).toBe(true);
    expect(byId.get('blurry')).toMatchObject({ blurry: true, decision: 'auto-out' });
    expect(byId.get('blurry')!.reasons[0]?.kind).toBe('blurry');
    expect(byId.get('missing')!.reasons[0]?.kind).toBe('no-analysis');
    expect(byId.get('missing')!.scores.sharpness).toBe(0.5);
    for (const c of r.candidates) expect(c.reasons.length).toBeGreaterThan(0);
    expect(r.summary).toMatchObject({ total: 15, analyzed: 14, picked: 6, alternates: 2, blurry: 1, clusters: 1, days: 1, places: 0, targetPhotos: 6 });
    expect(r.summary.picked + r.summary.alternates + r.summary.rejected).toBe(15);
  });

  it('keeps user decisions and lets a user-in alternate win its burst', () => {
    const withUser = inputs.map((i) => (i.asset.id === 'burst-3' ? { ...i, decision: 'user-in' as const } : i.asset.id === 'p9' ? { ...i, decision: 'user-out' as const } : i));
    const r = buildSelection(withUser, { rules, targetPhotos: 6 });
    const byId = new Map(r.candidates.map((c) => [c.assetId, c]));
    expect(byId.get('burst-3')).toMatchObject({ decision: 'user-in', clusterRank: 0 });
    expect(byId.get('burst-2')).toMatchObject({ decision: 'auto-out', clusterRank: 1 });
    expect(byId.get('p9')).toMatchObject({ decision: 'user-out' });
    expect(byId.get('p9')!.reasons[0]?.kind).toBe('user-out');
    expect(r.summary.picked).toBe(6);
  });

  it('places everything when near-duplicate collapse and blur skipping are off', () => {
    const r = buildSelection(inputs, { rules: { ...rules, collapseNearDuplicates: false, skipBlurry: false }, targetPhotos: 50 });
    expect(r.summary.picked).toBe(15);
    expect(r.summary.clusters).toBe(0);
  });
});

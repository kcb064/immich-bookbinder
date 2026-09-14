import { Book, SelectionRun, SelectionView, targetPhotosFor } from '@bookbinder/shared';
import { placedAssetIds } from '@bookbinder/layout';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, loginCookie, type TestApp } from '../test/helpers.js';
import { startFakeImmich, type FakeImmich } from '../test/fake-immich.js';
import { toFaceBoxes } from './service.js';

const LayoutResponse = z.object({ book: Book, warnings: z.array(z.string()), photoCount: z.number() });

describe('toFaceBoxes', () => {
  it('normalises Immich pixel boxes to fractions and keeps the person', () => {
    const boxes = toFaceBoxes([
      { id: 'f1', imageWidth: 4000, imageHeight: 3000, boundingBoxX1: 2000, boundingBoxX2: 2400, boundingBoxY1: 300, boundingBoxY2: 900, person: { id: 'p1', name: 'Kevin' } as never },
      { id: 'f2', imageWidth: 0, imageHeight: 0, boundingBoxX1: 1, boundingBoxX2: 2, boundingBoxY1: 1, boundingBoxY2: 2, person: null },
    ]);
    expect(boxes).toEqual([{ x: 0.5, y: 0.1, w: 0.1, h: 0.2, personId: 'p1', name: 'Kevin' }]);
  });
});

describe('selection engine against the fake Immich', () => {
  let t: TestApp;
  let cookie: string;
  let immich: FakeImmich;
  let bookId: string;
  const TARGET_PAGES = 12;

  beforeAll(async () => {
    immich = await startFakeImmich({ photos: 60, originalLongEdge: 1200 });
    t = await createTestApp({}, { selection: { concurrency: 2 } });
    cookie = await loginCookie(t.app);
    await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: immich.url, apiKey: 'test-api-key-1234' } });
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: {
        title: 'Portugal 2026',
        formatId: 'lulu-square-8.5',
        themeId: 'warm-editorial',
        rules: { sources: [{ kind: 'album', albumIds: ['album-trip'] }], targetPages: TARGET_PAGES, featuredPersonIds: ['person-sam'] },
      },
    });
    bookId = Book.parse(created.json()).id;
  });
  afterAll(async () => {
    await t.cleanup();
    await immich.close();
  });

  it('starts empty and refuses decisions before a run', async () => {
    const empty = SelectionView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection`, headers: { cookie } })).json());
    expect(empty.candidates).toEqual([]);
    expect(empty.summary).toBeUndefined();
    expect(empty.run).toBeUndefined();
    const res = await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}/selection/decisions`, headers: { cookie }, payload: { decisions: [{ assetId: 'asset-0000', decision: 'user-out' }] } });
    expect(res.statusCode).toBe(404);
  });

  it('runs: gathers, analyses previews, fetches faces, clusters bursts, flags blur and picks to target', async () => {
    const queued = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/selection/runs`, headers: { cookie }, payload: {} });
    expect(queued.statusCode, queued.body).toBe(202);
    const run = SelectionRun.parse(queued.json());
    expect(run.status).toBe('queued');
    await t.app.selections.idle();

    const finished = SelectionRun.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection/runs/${run.id}`, headers: { cookie } })).json());
    expect(finished.error).toBeUndefined();
    expect(finished.status).toBe('done');
    expect(finished.phase).toBe('done');
    expect(finished.warnings).toEqual([]);

    const view = SelectionView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection`, headers: { cookie } })).json());
    expect(view.candidates).toHaveLength(60);
    expect(view.run?.id).toBe(run.id);
    const summary = view.summary!;
    expect(summary.total).toBe(60);
    expect(summary.analyzed).toBe(60);
    expect(summary.targetPhotos).toBe(targetPhotosFor(TARGET_PAGES));
    expect(summary.picked).toBe(summary.targetPhotos);
    expect(summary.picked + summary.alternates + summary.rejected).toBe(60);
    // Six bursts of three (photos 4/5/6, 14/15/16, ...) plus the Immich duplicate pairs.
    expect(summary.clusters).toBeGreaterThanOrEqual(6);
    expect(summary.blurry).toBeGreaterThanOrEqual(3);
    expect(summary.days).toBe(5);
    expect(summary.places).toBeGreaterThanOrEqual(3);

    const byId = new Map(view.candidates.map((c) => [c.assetId, c]));
    // Burst frames share a cluster and only the best is picked automatically.
    const burst = ['asset-0004', 'asset-0005', 'asset-0006'].map((id) => byId.get(id)!);
    expect(new Set(burst.map((c) => c.clusterId)).size).toBe(1);
    expect(burst.filter((c) => c.clusterRank === 0)).toHaveLength(1);
    expect(burst.filter((c) => c.autoDecision === 'auto-in').length).toBeLessThanOrEqual(1);
    const loser = burst.find((c) => c.clusterRank > 0)!;
    expect(loser.reasons[0]).toMatchObject({ kind: 'duplicate', assetId: burst.find((c) => c.clusterRank === 0)!.assetId });
    // Immich duplicate group (8 and 9) clusters even though the pictures differ.
    expect(byId.get('asset-0008')!.clusterId).toBe(byId.get('asset-0009')!.clusterId);
    // Blurred photos are detected and skipped.
    const blurry = byId.get('asset-0007')!;
    expect(blurry.blurry).toBe(true);
    expect(blurry.decision).toBe('auto-out');
    expect(blurry.reasons.some((r) => r.kind === 'blurry')).toBe(true);
    expect(byId.get('asset-0000')!.blurry).toBe(false);
    // Every candidate has metrics, a hash and at least one reason.
    for (const c of view.candidates) {
      expect(c.metrics).toBeDefined();
      expect(c.phash).toMatch(/^[0-9a-f]{16}$/);
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.scores.composite).toBeGreaterThanOrEqual(0);
    }
    // Faces were fetched for people photos and mapped to fractions; the featured person appears.
    expect(immich.requests.some((r) => r.path === '/api/faces')).toBe(true);
    const withFaces = view.candidates.filter((c) => c.faces && c.faces.length > 0);
    expect(withFaces.length).toBeGreaterThan(0);
    expect(withFaces[0]!.faces![0]).toMatchObject({ personId: expect.any(String) });
    const assets = (await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/assets`, headers: { cookie } })).json() as Array<{ id: string; people: Array<{ id: string }> }>;
    const samIds = new Set(assets.filter((a) => a.people.some((p) => p.id === 'person-sam')).map((a) => a.id));
    expect(view.candidates.some((c) => samIds.has(c.assetId) && (c.decision === 'auto-in' || c.decision === 'user-in'))).toBe(true);
    // Favourites are always in.
    const favIds = new Set(immich.assets.filter((a) => a.isFavorite && a.albumIds.includes('album-trip')).map((a) => a.id));
    for (const c of view.candidates) if (favIds.has(c.assetId) && c.clusterRank === 0 && !c.blurry) expect(c.decision).toBe('auto-in');
    // Only previews were fetched for scoring.
    expect(immich.requests.some((r) => r.path.includes('/original'))).toBe(false);
    const book = Book.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}`, headers: { cookie } })).json());
    expect(book.status).toBe('selecting');
  }, 120_000);

  it('applies and resets user decisions and counts them in the summary', async () => {
    const before = SelectionView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection`, headers: { cookie } })).json());
    const picked = before.candidates.find((c) => c.decision === 'auto-in')!;
    const rejected = before.candidates.find((c) => c.decision === 'auto-out' && c.clusterRank === 0 && !c.blurry)!;
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/books/${bookId}/selection/decisions`,
      headers: { cookie },
      payload: { decisions: [{ assetId: picked.assetId, decision: 'user-out' }, { assetId: rejected.assetId, decision: 'user-in' }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = SelectionView.parse(res.json());
    const byId = new Map(after.candidates.map((c) => [c.assetId, c]));
    expect(byId.get(picked.assetId)).toMatchObject({ decision: 'user-out', autoDecision: 'auto-in' });
    expect(byId.get(picked.assetId)!.reasons[0]!.kind).toBe('user-out');
    expect(byId.get(rejected.assetId)).toMatchObject({ decision: 'user-in', autoDecision: 'auto-out' });
    expect(after.summary!.picked).toBe(before.summary!.picked);

    const reset = await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}/selection/decisions`, headers: { cookie }, payload: { decisions: [{ assetId: picked.assetId, decision: 'auto' }] } });
    const view = SelectionView.parse(reset.json());
    expect(view.candidates.find((c) => c.assetId === picked.assetId)!.decision).toBe('auto-in');
    expect(view.summary!.picked).toBe(before.summary!.picked + 1);
  });

  it('re-runs quickly from cached analysis, keeps user decisions and honours new weights', async () => {
    const before = immich.requests.length;
    const book = Book.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}`, headers: { cookie } })).json());
    const rules = { ...book.rules!, weights: { ...book.rules!.weights, variety: 0 }, spreadAcrossDays: false };
    const queued = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/selection/runs`, headers: { cookie }, payload: { rules } });
    expect(queued.statusCode, queued.body).toBe(202);
    await t.app.selections.idle();
    const run = SelectionRun.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection/runs/${SelectionRun.parse(queued.json()).id}`, headers: { cookie } })).json());
    expect(run.status, run.error).toBe('done');
    // No previews or faces were re-fetched.
    expect(immich.requests.slice(before).filter((r) => r.path.includes('/thumbnail') || r.path === '/api/faces')).toEqual([]);
    const view = SelectionView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection`, headers: { cookie } })).json());
    expect(view.candidates.some((c) => c.decision === 'user-in')).toBe(true);
    const saved = Book.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}`, headers: { cookie } })).json());
    expect(saved.rules?.weights.variety).toBe(0);
    expect(saved.rules?.spreadAcrossDays).toBe(false);
  }, 60_000);

  it('lays out only the picked photos, best scores steering the hero slots', async () => {
    const view = SelectionView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection`, headers: { cookie } })).json());
    const pickedIds = new Set(view.candidates.filter((c) => c.decision === 'auto-in' || c.decision === 'user-in').map((c) => c.assetId));
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    const { book } = LayoutResponse.parse(res.json());
    const placed = placedAssetIds(book.pages);
    expect(new Set(placed)).toEqual(pickedIds);
    expect(book.status).toBe('editing');
    expect(book.pages.length).toBeGreaterThanOrEqual(24);
  });

  it('answers 409 for a run without Immich and 400 for a book without rules', async () => {
    const noRules = await t.app.inject({ method: 'POST', url: '/api/books', headers: { cookie }, payload: { title: 'Bare', formatId: 'lulu-square-8.5', themeId: 'warm-editorial' } });
    const bareId = Book.parse(noRules.json()).id;
    expect((await t.app.inject({ method: 'POST', url: `/api/books/${bareId}/selection/runs`, headers: { cookie }, payload: {} })).statusCode).toBe(400);
    await t.app.inject({ method: 'DELETE', url: '/api/settings/immich', headers: { cookie } });
    expect((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/selection/runs`, headers: { cookie }, payload: {} })).statusCode).toBe(409);
    await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: immich.url, apiKey: 'test-api-key-1234' } });
  });
});

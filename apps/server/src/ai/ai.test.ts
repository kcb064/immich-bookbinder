import { AiJob, Book, SelectionView, type Candidate } from '@bookbinder/shared';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, loginCookie, type TestApp } from '../test/helpers.js';
import { startFakeClaude, type FakeClaude } from '../test/fake-claude.js';
import { startFakeImmich, type FakeImmich } from '../test/fake-immich.js';
import { parseLooseJson } from './client.js';
import { burstUnchanged, mergeSlotTexts, swapWinner } from './service.js';

describe('ai helpers', () => {
  it('parses fenced and prefixed JSON', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLooseJson('Sure: {"a": [1,2]} done')).toEqual({ a: [1, 2] });
    expect(parseLooseJson('nope')).toBeUndefined();
  });

  it('merges written texts only where the user has not typed', () => {
    const current = [
      { id: 'p1', index: 0, templateId: 'one-up-matted', slots: [{ slotId: 'p1', assetId: 'a' }, { slotId: 'cap', text: 'Mine' }] },
      { id: 'p2', index: 1, templateId: 'one-up-matted', slots: [{ slotId: 'p1', assetId: 'b', frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    ];
    const written = [
      { id: 'p1', index: 0, templateId: 'one-up-matted', slots: [{ slotId: 'cap', text: 'Robot' }] },
      { id: 'p2', index: 1, templateId: 'one-up-matted', slots: [{ slotId: 'cap', text: 'Robot 2' }] },
    ];
    const merged = mergeSlotTexts(current, written);
    expect(merged[0]!.slots.find((s) => s.slotId === 'cap')?.text).toBe('Mine');
    expect(merged[1]!.slots).toEqual([{ slotId: 'p1', assetId: 'b', frame: { x: 0, y: 0, w: 1, h: 1 } }, { slotId: 'cap', text: 'Robot 2' }]);
  });

  it('leaves a burst alone once the user or another job touched it', () => {
    const base = { scores: { sharpness: 1, exposure: 1, aesthetic: 1, people: 0, composite: 0.8 }, clusterId: 'c', clusterSize: 3, blurry: false, autoDecision: 'auto-in' as const };
    const seen: Candidate[] = [
      { ...base, assetId: 'w', clusterRank: 0, decision: 'auto-in', reasons: [] },
      { ...base, assetId: 'o', clusterRank: 1, decision: 'auto-out', reasons: [] },
    ];
    const fresh = new Map<string, Candidate>(seen.map((c) => [c.assetId, c]));
    expect(burstUnchanged(seen, fresh)).toBe(true);
    expect(burstUnchanged(seen, new Map([...fresh, ['o', { ...seen[1]!, decision: 'user-in' as const }]]))).toBe(false);
    expect(burstUnchanged(seen, new Map([...fresh, ['w', { ...seen[0]!, reasons: [{ kind: 'ai' as const, text: 'picked', assetId: 'o' }] }]]))).toBe(false);
    expect(burstUnchanged(seen, new Map([['w', seen[0]!]]))).toBe(false);
  });

  it('swaps a burst winner and keeps a way back', () => {
    const base = { scores: { sharpness: 1, exposure: 1, aesthetic: 1, people: 0, composite: 0.8 }, clusterId: 'c', clusterSize: 3, blurry: false, autoDecision: 'auto-in' as const };
    const winner = { ...base, assetId: 'w', clusterRank: 0, decision: 'auto-in' as const, reasons: [{ kind: 'best-of-burst' as const, text: 'best' }] };
    const other = { ...base, assetId: 'o', clusterRank: 2, decision: 'auto-out' as const, autoDecision: 'auto-out' as const, reasons: [{ kind: 'duplicate' as const, text: 'dup', assetId: 'w' }] };
    const [chosen, demoted] = swapWinner(winner, other, 'eyes open');
    expect(chosen).toMatchObject({ assetId: 'o', clusterRank: 0, decision: 'auto-in' });
    expect(chosen!.reasons[0]).toEqual({ kind: 'ai', text: 'Claude picked this frame of the burst: eyes open', assetId: 'w' });
    expect(demoted).toMatchObject({ assetId: 'w', clusterRank: 2, decision: 'auto-out' });
    expect(demoted!.reasons[0]!.assetId).toBe('o');
  });
});

describe('Claude features against the fakes', () => {
  let t: TestApp;
  let cookie: string;
  let immich: FakeImmich;
  let claude: FakeClaude;
  let bookId: string;

  beforeAll(async () => {
    immich = await startFakeImmich({ photos: 40, originalLongEdge: 1200 });
    claude = await startFakeClaude();
    t = await createTestApp({ AI_BASE_URL: claude.url }, { selection: { concurrency: 2 } });
    cookie = await loginCookie(t.app);
    await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: immich.url, apiKey: 'test-api-key-1234' } });
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Portugal 2026', formatId: 'lulu-square-8.5', themeId: 'warm-editorial', rules: { sources: [{ kind: 'album', albumIds: ['album-trip'] }], targetPages: 24 } },
    });
    bookId = Book.parse(created.json()).id;
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await immich.close();
    await claude.close();
  });

  const job = (kind: string, payload: Record<string, unknown> = {}) => t.app.inject({ method: 'POST', url: `/api/books/${bookId}/ai/${kind}`, headers: { cookie }, payload });
  const jobs = async () => z.array(AiJob).parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/ai/jobs`, headers: { cookie } })).json());
  const book = async () => Book.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}`, headers: { cookie } })).json());

  it('refuses every feature until Claude is enabled with a key, and tests the key', async () => {
    expect((await job('captions')).statusCode).toBe(409);
    const off = await t.app.inject({ method: 'PUT', url: '/api/settings/ai', headers: { cookie }, payload: { enabled: true } });
    expect(off.json().ai).toEqual({ enabled: true, apiKeySet: false, model: 'claude-opus-5' });
    expect((await job('captions')).statusCode).toBe(409);
    const bad = await t.app.inject({ method: 'PUT', url: '/api/settings/ai', headers: { cookie }, payload: { enabled: true, apiKey: 'bad-key', model: 'claude-sonnet-5' } });
    expect(bad.json().ai).toEqual({ enabled: true, apiKeySet: true, model: 'claude-sonnet-5' });
    expect(JSON.stringify(bad.json())).not.toContain('bad-key');
    const failed = (await t.app.inject({ method: 'POST', url: '/api/ai/test', headers: { cookie } })).json();
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/401/);
    await t.app.inject({ method: 'PUT', url: '/api/settings/ai', headers: { cookie }, payload: { enabled: true, apiKey: 'sk-ant-test' } });
    const ok = (await t.app.inject({ method: 'POST', url: '/api/ai/test', headers: { cookie } })).json();
    expect(ok).toMatchObject({ ok: true, model: 'claude-sonnet-5' });
    expect(ok.usage.requests).toBe(1);
    expect(ok.usage.costUsd).toBeGreaterThan(0);
    expect(claude.requests.at(-1)?.model).toBe('claude-sonnet-5');
  });

  it('writes captions and chapter titles only where nothing was typed, sending thumbnails only', async () => {
    // Selection first (clusters for the burst test), then the layout.
    const run = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/selection/runs`, headers: { cookie }, payload: {} });
    expect(run.statusCode).toBe(202);
    await t.app.selections.idle();
    expect((await job('captions')).statusCode).toBe(409); // no pages yet
    const laid = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/layout`, headers: { cookie }, payload: {} });
    expect(laid.statusCode).toBe(200);
    // The user types one caption and one chapter title; those must survive.
    const before = await book();
    const captioned = before.pages.find((p) => p.templateId === 'one-up-matted' || p.templateId === 'hero-strip');
    const chapterPage = before.pages.find((p) => p.templateId === 'chapter-title');
    expect(captioned).toBeDefined();
    expect(chapterPage).toBeDefined();
    const typed: Book = {
      ...before,
      pages: before.pages.map((p) => (p === captioned ? { ...p, slots: [...p.slots, { slotId: 'cap', text: 'My own words' }] } : p === chapterPage ? { ...p, slots: [{ slotId: 'title', text: 'My chapter' }] } : p)),
    };
    expect((await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}`, headers: { cookie }, payload: typed })).statusCode).toBe(200);

    claude.requests.length = 0;
    const started = await job('captions');
    expect(started.statusCode, started.body).toBe(202);
    expect(AiJob.parse(started.json()).status).toBe('queued');
    expect((await job('foreword')).statusCode).toBe(409); // one job per book at a time
    await t.app.ai.idle();
    const [done] = await jobs();
    expect(done).toMatchObject({ kind: 'captions', status: 'done', model: 'claude-sonnet-5' });
    expect(done!.result!.captions).toBeGreaterThan(0);
    expect(done!.result!.skipped).toBe(2); // the typed caption and the typed chapter title
    expect(done!.usage!.requests).toBeGreaterThan(0);
    expect(done!.usage!.costUsd).toBeGreaterThan(0);
    // Thumbnails only: every image is small.
    expect(claude.requests.length).toBeGreaterThan(0);
    for (const r of claude.requests) for (const bytes of r.imageBytes) expect(bytes).toBeLessThan(60_000);
    expect(claude.requests.some((r) => r.imageBytes.length > 0)).toBe(true);

    const after = await book();
    const mine = after.pages.find((p) => p.id === captioned!.id)!;
    expect(mine.slots.find((s) => s.slotId === 'cap')?.text).toBe('My own words');
    expect(after.pages.find((p) => p.id === chapterPage!.id)!.slots.find((s) => s.slotId === 'title')?.text).toBe('My chapter');
    const written = after.pages.filter((p) => p.id !== captioned!.id && p.slots.some((s) => s.slotId === 'cap' && s.text?.startsWith('A moment on page')));
    expect(written.length).toBe(done!.result!.captions);
    const otherChapters = after.pages.filter((p) => p.templateId === 'chapter-title' && p.id !== chapterPage!.id);
    for (const p of otherChapters) expect(p.slots.find((s) => s.slotId === 'title')?.text).toMatch(/^Days in /);
    expect(done!.result!.chapterTitles).toBe(otherChapters.length);
    expect(after.updatedAt > typed.updatedAt).toBe(true);
  });

  it('picks the best frame of each burst, marks it, and one call reverts it', async () => {
    const view = SelectionView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection`, headers: { cookie } })).json());
    const clusters = new Map<string, typeof view.candidates>();
    for (const c of view.candidates) if (c.clusterId) clusters.set(c.clusterId, [...(clusters.get(c.clusterId) ?? []), c]);
    const bursts = [...clusters.values()].filter((m) => m.length >= 3);
    expect(bursts.length).toBeGreaterThan(0);

    claude.requests.length = 0;
    expect((await job('bursts')).statusCode).toBe(202);
    await t.app.ai.idle();
    const [done] = await jobs();
    expect(done).toMatchObject({ kind: 'bursts', status: 'done' });
    expect(done!.result!.clusters).toBe(bursts.length);
    expect(done!.result!.changed).toBe(bursts.length); // the fake always prefers frame 2
    expect(claude.requests).toHaveLength(bursts.length);

    const after = SelectionView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection`, headers: { cookie } })).json());
    const picked = after.candidates.filter((c) => c.reasons[0]?.kind === 'ai' && c.clusterRank === 0);
    expect(picked).toHaveLength(bursts.length);
    const demoted = after.candidates.filter((c) => c.reasons[0]?.kind === 'ai' && c.clusterRank !== 0);
    expect(demoted).toHaveLength(bursts.length);
    const first = picked[0]!;
    const old = after.candidates.find((c) => c.assetId === first.reasons[0]!.assetId)!;
    expect(old.decision).toBe('auto-out');
    expect(first.decision).toBe('auto-in');

    // A second run leaves Claude's picks alone (nothing eligible), and revert swaps back.
    expect((await job('bursts')).statusCode).toBe(202);
    await t.app.ai.idle();
    expect((await jobs())[0]!.result!.clusters).toBe(0);
    const reverted = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/ai/bursts/revert`, headers: { cookie }, payload: { assetId: first.assetId } });
    expect(reverted.statusCode, reverted.body).toBe(200);
    const restored = SelectionView.parse((await t.app.inject({ method: 'GET', url: `/api/books/${bookId}/selection`, headers: { cookie } })).json());
    const w = restored.candidates.find((c) => c.assetId === old.assetId)!;
    const l = restored.candidates.find((c) => c.assetId === first.assetId)!;
    expect(w).toMatchObject({ clusterRank: 0, decision: 'auto-in' });
    expect(l).toMatchObject({ clusterRank: first.reasons.length > 0 ? old.clusterRank : 0, decision: 'auto-out' });
    expect(w.reasons.some((r) => r.kind === 'ai')).toBe(false);
    expect(l.reasons.some((r) => r.kind === 'ai')).toBe(false);
    expect((await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/ai/bursts/revert`, headers: { cookie }, payload: { assetId: first.assetId } })).statusCode).toBe(404);
  });

  it('writes a foreword on the title page, keeps a typed one unless told to overwrite, and reports API failures', async () => {
    claude.requests.length = 0;
    expect((await job('foreword')).statusCode).toBe(202);
    await t.app.ai.idle();
    const [done] = await jobs();
    expect(done).toMatchObject({ kind: 'foreword', status: 'done' });
    expect(done!.result!.text).toContain('Portugal 2026');
    expect(claude.requests[0]!.imageBytes).toEqual([]);
    expect(claude.requests[0]!.text).toContain('Photographs:');
    const b = await book();
    const title = b.pages.find((p) => p.templateId === 'title-page')!;
    expect(title.slots.find((s) => s.slotId === 'foreword')?.text).toBe(done!.result!.text);

    // Typed foreword is kept without overwrite, replaced with it.
    await t.app.inject({ method: 'PUT', url: `/api/books/${bookId}`, headers: { cookie }, payload: { ...b, pages: b.pages.map((p) => (p.id === title.id ? { ...p, slots: [{ slotId: 'foreword', text: 'Hand written' }] } : p)) } });
    expect((await job('foreword')).statusCode).toBe(202);
    await t.app.ai.idle();
    expect((await jobs())[0]!.result).toEqual({ text: 'Hand written', skipped: 1 });
    expect((await job('foreword', { overwrite: true })).statusCode).toBe(202);
    await t.app.ai.idle();
    expect((await book()).pages.find((p) => p.id === title.id)!.slots.find((s) => s.slotId === 'foreword')?.text).toContain('Portugal 2026');

    claude.failNext.status = 529;
    claude.failNext.count = 5;
    expect((await job('foreword', { overwrite: true })).statusCode).toBe(202);
    await t.app.ai.idle();
    const failed = (await jobs())[0]!;
    expect(failed.status).toBe('error');
    expect(failed.error).toMatch(/529/);
    claude.failNext.count = 0;
  });
});

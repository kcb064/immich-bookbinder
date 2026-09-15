import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, loginCookie, type TestApp } from '../test/helpers.js';
import { Notifier, type NotifierTarget } from './notifier.js';

interface Hit {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** A tiny HTTP sink standing in for ntfy, Gotify or a webhook receiver; `fail` makes it answer 500 that many times. */
async function startSink(): Promise<{ url: string; hits: Hit[]; fail: { count: number }; close: () => Promise<void> }> {
  const hits: Hit[] = [];
  const fail = { count: 0 };
  const app = Fastify({ logger: false });
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.all('/*', async (req, reply) => {
    hits.push({ path: req.url, headers: req.headers as Hit['headers'], body: req.body });
    if (fail.count > 0) {
      fail.count--;
      return reply.code(500).send('nope');
    }
    return { ok: true };
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, hits, fail, close: () => app.close() };
}

const log = { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined, child: () => log } as never;
const events = { renderDone: true, orderStatus: true, selectionFailed: false };

describe('Notifier', () => {
  let sink: Awaited<ReturnType<typeof startSink>>;
  beforeAll(async () => {
    sink = await startSink();
  });
  afterAll(async () => {
    await sink.close();
  });

  const make = (target: NotifierTarget | undefined, publicBase?: string) => new Notifier({ target: () => target, publicBase: () => publicBase, log, retryDelayMs: 1 });

  it('formats ntfy, Gotify and webhook deliveries and appends the public link', async () => {
    sink.hits.length = 0;
    const event = { kind: 'render-done' as const, title: 'Print PDF ready', message: 'Portugal: 48 pages.', bookId: 'b1', bookTitle: 'Portugal', path: '/books/b1' };
    const ntfy = make({ kind: 'ntfy', url: `${sink.url}/books`, token: 'tk_secret', events }, 'https://books.example.com');
    expect(await ntfy.deliver(event)).toEqual({ ok: true, status: 200 });
    const gotify = make({ kind: 'gotify', url: `${sink.url}/`, token: 'AppToken', events });
    expect((await gotify.deliver({ ...event, level: 'error' })).ok).toBe(true);
    const hook = make({ kind: 'webhook', url: `${sink.url}/hook`, events }, 'https://books.example.com');
    expect((await hook.deliver(event)).ok).toBe(true);

    expect(sink.hits).toHaveLength(3);
    const [n, g, h] = sink.hits;
    expect(n!.path).toBe('/books');
    expect(n!.headers.title).toBe('Print PDF ready');
    expect(n!.headers.authorization).toBe('Bearer tk_secret');
    expect(n!.headers.click).toBe('https://books.example.com/books/b1');
    expect(n!.headers.priority).toBe('default');
    expect(n!.body).toBe('Portugal: 48 pages.\nhttps://books.example.com/books/b1');
    expect(g!.path).toBe('/message');
    expect(g!.headers['x-gotify-key']).toBe('AppToken');
    expect(g!.body).toMatchObject({ title: 'Print PDF ready', message: 'Portugal: 48 pages.', priority: 8 });
    expect(h!.path).toBe('/hook');
    expect(h!.headers.authorization).toBeUndefined();
    expect(h!.body).toMatchObject({ event: 'render-done', title: 'Print PDF ready', bookId: 'b1', bookTitle: 'Portugal', level: 'info', url: 'https://books.example.com/books/b1' });
  });

  it('retries once, then reports the failure; notify() never throws and honours the event switches', async () => {
    sink.hits.length = 0;
    sink.fail.count = 1;
    const hook = make({ kind: 'webhook', url: `${sink.url}/hook`, events });
    expect(await hook.deliver({ kind: 'test', title: 't', message: 'm' })).toEqual({ ok: true, status: 200 });
    expect(sink.hits).toHaveLength(2);

    sink.hits.length = 0;
    sink.fail.count = 2;
    const failed = await hook.deliver({ kind: 'test', title: 't', message: 'm' });
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/HTTP 500 \(after one retry\)/);
    expect(sink.hits).toHaveLength(2);

    sink.hits.length = 0;
    hook.notify({ kind: 'selection-failed', title: 'off', message: 'switched off' });
    hook.notify({ kind: 'order-status', title: 'on', message: 'switched on' });
    await hook.idle();
    expect(sink.hits.map((h) => (h.body as { title: string }).title)).toEqual(['on']);

    const off = make(undefined);
    expect(off.enabled('render-done')).toBe(false);
    off.notify({ kind: 'render-done', title: 'x', message: 'y' });
    await off.idle();
    const unreachable = make({ kind: 'webhook', url: 'http://127.0.0.1:1/hook', events });
    expect((await unreachable.deliver({ kind: 'test', title: 't', message: 'm' })).ok).toBe(false);
  });
});

describe('notification settings and test route', () => {
  let t: TestApp;
  let cookie: string;
  let sink: Awaited<ReturnType<typeof startSink>>;
  beforeAll(async () => {
    sink = await startSink();
    t = await createTestApp({}, { notify: { retryDelayMs: 1 } });
    cookie = await loginCookie(t.app);
  });
  afterAll(async () => {
    await t.cleanup();
    await sink.close();
  });

  it('stores the target without exposing the token, tests it, and fires on a failed selection', async () => {
    const none = await t.app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie } });
    expect(none.statusCode).toBe(409);

    const saved = await t.app.inject({ method: 'PUT', url: '/api/settings/notifications', headers: { cookie }, payload: { kind: 'ntfy', url: `${sink.url}/bookbinder/`, token: 'secret-token', events: { renderDone: true, orderStatus: false, selectionFailed: true } } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().notifications).toEqual({ configured: true, kind: 'ntfy', url: `${sink.url}/bookbinder`, tokenSet: true, events: { renderDone: true, orderStatus: false, selectionFailed: true } });
    expect(JSON.stringify(saved.json())).not.toContain('secret-token');

    sink.hits.length = 0;
    const test = await t.app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie } });
    expect(test.json()).toEqual({ ok: true, status: 200 });
    expect(sink.hits[0]!.headers.authorization).toBe('Bearer secret-token');
    expect(sink.hits[0]!.path).toBe('/bookbinder');

    // A typed (unsaved) target is tested as is; an empty token drops the stored one for that test only.
    sink.hits.length = 0;
    const typed = await t.app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie }, payload: { kind: 'webhook', url: `${sink.url}/typed`, token: '' } });
    expect(typed.json().ok).toBe(true);
    expect(sink.hits[0]!.path).toBe('/typed');
    expect(sink.hits[0]!.headers.authorization).toBeUndefined();
    // Leaving the token field alone lends the stored token only to the target it was saved for, never to another URL.
    sink.hits.length = 0;
    const elsewhere = await t.app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie }, payload: { kind: 'ntfy', url: `${sink.url}/elsewhere/` } });
    expect(elsewhere.json().ok).toBe(true);
    expect(sink.hits[0]!.path).toBe('/elsewhere/');
    expect(sink.hits[0]!.headers.authorization).toBeUndefined();
    sink.hits.length = 0;
    const same = await t.app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie }, payload: { kind: 'ntfy', url: `${sink.url}/bookbinder/` } });
    expect(same.json().ok).toBe(true);
    expect(sink.hits[0]!.headers.authorization).toBe('Bearer secret-token');

    // A selection run against an unreachable Immich fails and notifies.
    await t.app.inject({ method: 'PUT', url: '/api/settings/immich', headers: { cookie }, payload: { url: 'http://127.0.0.1:1', apiKey: 'test-api-key-1234' } });
    sink.hits.length = 0;
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Notify me', formatId: 'lulu-square-8.5', themeId: 'warm-editorial', rules: { sources: [{ kind: 'favorites' }], targetPages: 24 } },
    });
    const bookId = created.json().id as string;
    const run = await t.app.inject({ method: 'POST', url: `/api/books/${bookId}/selection/runs`, headers: { cookie }, payload: {} });
    expect(run.statusCode, run.body).toBe(202);
    await t.app.selections.idle();
    await t.app.notifier.idle();
    expect(sink.hits).toHaveLength(1);
    expect(sink.hits[0]!.headers.title).toBe('Photo selection failed');
    expect(sink.hits[0]!.headers.priority).toBe('high');
    expect(String(sink.hits[0]!.body)).toContain('Notify me');

    const bad = await t.app.inject({ method: 'PUT', url: '/api/settings/notifications', headers: { cookie }, payload: { kind: 'sms', url: 'nope' } });
    expect(bad.statusCode).toBe(400);
    const cleared = await t.app.inject({ method: 'DELETE', url: '/api/settings/notifications', headers: { cookie } });
    expect(cleared.json().notifications.configured).toBe(false);
  });
});

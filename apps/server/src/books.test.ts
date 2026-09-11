import { Book } from '@bookbinder/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, loginCookie, type TestApp } from './test/helpers.js';

describe('books CRUD', () => {
  let t: TestApp;
  let cookie: string;
  beforeAll(async () => {
    t = await createTestApp();
    cookie = await loginCookie(t.app);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it('creates the sqlite database inside DATA_DIR', () => {
    expect(existsSync(join(t.dataDir, 'bookbinder.sqlite'))).toBe(true);
    expect(existsSync(join(t.dataDir, 'cache'))).toBe(true);
    expect(existsSync(join(t.dataDir, 'exports'))).toBe(true);
  });

  it('requires auth', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/books' })).statusCode).toBe(401);
  });

  it('round-trips create, list, get, update, delete', async () => {
    const empty = await t.app.inject({ method: 'GET', url: '/api/books', headers: { cookie } });
    expect(empty.json()).toEqual([]);

    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: {
        title: 'Portugal 2026',
        formatId: 'square-8.5',
        themeId: 'warm-editorial',
        rules: { sources: [{ kind: 'favorites' }] },
      },
    });
    expect(created.statusCode).toBe(201);
    const book = Book.parse(created.json());
    expect(book.status).toBe('draft');
    expect(book.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(book.pages).toEqual([]);
    expect(book.rules?.targetPages).toBe(48);
    expect(book.createdAt).toBe(book.updatedAt);

    const list = await t.app.inject({ method: 'GET', url: '/api/books', headers: { cookie } });
    expect(list.json()).toEqual([
      expect.objectContaining({ id: book.id, title: 'Portugal 2026', status: 'draft', pageCount: 0 }),
    ]);

    const got = await t.app.inject({ method: 'GET', url: `/api/books/${book.id}`, headers: { cookie } });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual(created.json());

    const updatedBody: Book = {
      ...book,
      title: 'Portugal, May 2026',
      status: 'editing',
      pages: [{ id: 'p1', index: 0, templateId: 'OneUpFullBleed', slots: [{ slotId: 's1', assetId: 'a1' }] }],
      createdAt: '2000-01-01T00:00:00.000Z', // must be ignored
    };
    const updated = await t.app.inject({
      method: 'PUT',
      url: `/api/books/${book.id}`,
      headers: { cookie },
      payload: updatedBody,
    });
    expect(updated.statusCode).toBe(200);
    const after = Book.parse(updated.json());
    expect(after.title).toBe('Portugal, May 2026');
    expect(after.status).toBe('editing');
    expect(after.pages).toHaveLength(1);
    expect(after.createdAt).toBe(book.createdAt);
    expect(after.updatedAt >= book.updatedAt).toBe(true);

    const summary = (await t.app.inject({ method: 'GET', url: '/api/books', headers: { cookie } })).json();
    expect(summary[0]).toMatchObject({ title: 'Portugal, May 2026', status: 'editing', pageCount: 1 });

    const mismatch = await t.app.inject({
      method: 'PUT',
      url: `/api/books/${book.id}`,
      headers: { cookie },
      payload: { ...after, id: 'other' },
    });
    expect(mismatch.statusCode).toBe(400);

    const invalid = await t.app.inject({
      method: 'PUT',
      url: `/api/books/${book.id}`,
      headers: { cookie },
      payload: { ...after, title: '' },
    });
    expect(invalid.statusCode).toBe(400);

    const del = await t.app.inject({ method: 'DELETE', url: `/api/books/${book.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: `/api/books/${book.id}`, headers: { cookie } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/books/${book.id}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('rejects invalid create bodies', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/books', headers: { cookie }, payload: { title: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/formatId/);
  });
});

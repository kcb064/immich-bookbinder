import { Book } from '@bookbinder/shared';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renders } from '../db/schema.js';
import { createTestApp, loginCookie, type TestApp } from '../test/helpers.js';

describe('render retention', () => {
  let t: TestApp;
  let cookie: string;
  let bookId: string;

  beforeAll(async () => {
    t = await createTestApp({}, { render: { webFonts: false } });
    cookie = await loginCookie(t.app);
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/books',
      headers: { cookie },
      payload: { title: 'Kept', formatId: 'lulu-square-8.5', themeId: 'warm-editorial', rules: { sources: [{ kind: 'album', albumIds: ['album-trip'] }], targetPages: 24 } },
    });
    bookId = Book.parse(created.json()).id;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  /** A done render row with a file on disk, finished at the given minute. */
  async function doneRender(kind: 'print' | 'preview', minute: number): Promise<{ id: string; filePath: string }> {
    const id = randomUUID();
    const dir = join(t.config.exportsDir, bookId);
    await mkdir(dir, { recursive: true });
    const filePath = kind === 'print' ? join(dir, `${id}.pdf`) : join(dir, id);
    if (kind === 'print') await writeFile(filePath, `pdf ${id}`);
    else {
      await mkdir(filePath, { recursive: true });
      await writeFile(join(filePath, '0000.png'), 'png');
    }
    const at = new Date(Date.UTC(2026, 8, 15, 10, minute)).toISOString();
    t.app.db
      .insert(renders)
      .values({ id, bookId, kind, status: 'done', pagesTotal: 1, pagesDone: 1, pageCount: 1, filePath, createdAt: at, startedAt: at, finishedAt: at })
      .run();
    return { id, filePath };
  }

  it('keeps the newest three per kind, deletes the rest with their files, and spares a render an unexpired export points at', async () => {
    const prints = [];
    for (let m = 0; m < 6; m++) prints.push(await doneRender('print', m));
    const previews = [];
    for (let m = 0; m < 4; m++) previews.push(await doneRender('preview', m));
    // The second-oldest print PDF is what an order's export (Lulu may still download it) points at.
    const held = prints[1]!;
    await t.app.exports.create({ bookId, renderId: held.id, filePath: held.filePath });
    // An expired export does not protect the oldest one.
    await t.app.exports.create({ bookId, renderId: prints[0]!.id, filePath: prints[0]!.filePath, ttlMs: 1 }, Date.now() - 10_000);

    expect(await t.app.renders.prune(bookId, 'print')).toBe(2);
    const left = t.app.renders.list(bookId).filter((r) => r.kind === 'print').map((r) => r.id);
    expect(left).toHaveLength(4);
    expect(left).toContain(held.id);
    for (const p of prints.slice(3)) expect(left).toContain(p.id);
    expect(existsSync(prints[0]!.filePath)).toBe(false);
    expect(existsSync(prints[2]!.filePath)).toBe(false);
    expect(existsSync(held.filePath)).toBe(true);
    // Other kinds are pruned on their own; a preview's directory goes with it.
    expect(await t.app.renders.prune(bookId, 'preview')).toBe(1);
    expect(existsSync(previews[0]!.filePath)).toBe(false);
    expect(existsSync(previews[3]!.filePath)).toBe(true);
    // Nothing more to do.
    expect(await t.app.renders.prune(bookId, 'print')).toBe(0);
    expect(await t.app.renders.prune(bookId, 'cover')).toBe(0);
  });
});

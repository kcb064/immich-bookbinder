import { Book, CreateRenderInput, Id, SelectionRules, LuluProduct, type BookAsset, type RenderJob } from '@bookbinder/shared';
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { LayoutError, layoutBook } from '../books/layout.js';
import type { BookSummary } from '../books/store.js';

const CreateBookInput = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  formatId: Id,
  themeId: Id,
  rules: SelectionRules.optional(),
  luluProduct: LuluProduct.optional(),
});
export type CreateBookInput = z.infer<typeof CreateBookInput>;

const IdParams = z.object({ id: Id });
const RenderParams = z.object({ id: Id, rid: Id });
const LayoutInput = z.object({ refetch: z.boolean().optional() });

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

function fileSlug(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'book'
  );
}

export const bookRoutes: FastifyPluginAsync = async (app) => {
  const store = app.books;

  app.get('/api/books', async (): Promise<BookSummary[]> => store.list());

  app.post('/api/books', async (request, reply) => {
    const parsed = CreateBookInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    const now = new Date().toISOString();
    const book = Book.parse({ ...parsed.data, id: randomUUID(), status: 'draft', createdAt: now, updatedAt: now });
    store.insert(book);
    return reply.code(201).send(book);
  });

  app.get('/api/books/:id', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const book = store.get(params.data.id);
    if (!book) return reply.notFound('Book not found');
    return book;
  });

  app.put('/api/books/:id', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const existing = store.get(params.data.id);
    if (!existing) return reply.notFound('Book not found');
    const parsed = Book.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    if (parsed.data.id !== params.data.id) return reply.badRequest('Body id does not match URL id');
    // Every asset may sit on at most one slot; slots must name the template they belong to.
    const seen = new Set<string>();
    for (const page of parsed.data.pages) {
      for (const slot of page.slots) {
        if (!slot.assetId) continue;
        if (seen.has(slot.assetId)) return reply.badRequest(`Asset ${slot.assetId} is placed more than once`);
        seen.add(slot.assetId);
      }
    }
    // createdAt is server-owned; updatedAt always advances.
    return store.save({ ...parsed.data, createdAt: existing.createdAt });
  });

  app.delete('/api/books/:id', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    for (const r of app.renders.list(params.data.id)) await app.renders.delete(r.id).catch(() => undefined);
    if (!store.delete(params.data.id)) return reply.notFound('Book not found');
    return reply.code(204).send();
  });

  /* ---------- Photos and layout ---------- */

  app.get('/api/books/:id/assets', async (request, reply): Promise<BookAsset[] | undefined> => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    if (!store.get(params.data.id)) return reply.notFound('Book not found');
    return store.assets(params.data.id);
  });

  /**
   * Gathers the book's photos from Immich (or re-uses the stored list) and lays them out on the
   * template library, replacing the current pages. Returns { book, warnings }.
   */
  app.post('/api/books/:id/layout', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const body = LayoutInput.safeParse(request.body ?? {});
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    const book = store.get(params.data.id);
    if (!book) return reply.notFound('Book not found');
    try {
      const result = await layoutBook({ store, client: () => app.immichClient() }, book, { refetch: body.data.refetch });
      return { book: result.book, warnings: result.warnings, photoCount: result.assets.length };
    } catch (err) {
      if (err instanceof LayoutError) {
        return reply.code(err.status).send({ statusCode: err.status, error: 'Layout failed', message: err.message });
      }
      request.log.error({ err }, 'layout failed');
      return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: `Could not fetch photos from Immich: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  /* ---------- Renders ---------- */

  app.get('/api/books/:id/renders', async (request, reply): Promise<RenderJob[] | undefined> => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    if (!store.get(params.data.id)) return reply.notFound('Book not found');
    return app.renders.list(params.data.id);
  });

  app.post('/api/books/:id/renders', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const body = CreateRenderInput.safeParse(request.body ?? {});
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    const book = store.get(params.data.id);
    if (!book) return reply.notFound('Book not found');
    if (book.pages.length === 0) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Lay out the book before rendering it' });
    if (!app.immichClient()) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Immich is not configured' });
    const job = app.renders.create(book, body.data.kind);
    return reply.code(202).send(job);
  });

  app.get('/api/books/:id/renders/:rid', async (request, reply) => {
    const params = RenderParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid id');
    const job = app.renders.get(params.data.rid);
    if (!job || job.bookId !== params.data.id) return reply.notFound('Render not found');
    return job;
  });

  app.delete('/api/books/:id/renders/:rid', async (request, reply) => {
    const params = RenderParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid id');
    const job = app.renders.get(params.data.rid);
    if (!job || job.bookId !== params.data.id) return reply.notFound('Render not found');
    try {
      await app.renders.delete(job.id);
    } catch (err) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: err instanceof Error ? err.message : String(err) });
    }
    return reply.code(204).send();
  });

  app.get('/api/books/:id/renders/:rid/pdf', async (request, reply) => {
    const params = RenderParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid id');
    const job = app.renders.get(params.data.rid);
    const book = store.get(params.data.id);
    if (!job || !book || job.bookId !== params.data.id) return reply.notFound('Render not found');
    const path = app.renders.filePath(job.id);
    if (!path) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: `Render is ${job.status}` });
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return reply.notFound('PDF file is missing on disk');
    }
    const name = `${fileSlug(book.title)}-${job.kind}.pdf`;
    return reply
      .type('application/pdf')
      .header('content-length', String(size))
      .header('content-disposition', `inline; filename="${name}"`)
      .header('cache-control', 'private, no-store')
      .send(createReadStream(path));
  });
};

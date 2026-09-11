import { Book, Id, SelectionRules, LuluProduct } from '@bookbinder/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { books, type BookRow } from '../db/schema.js';

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

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

export interface BookSummary {
  id: string;
  title: string;
  subtitle?: string;
  status: Book['status'];
  formatId: string;
  themeId: string;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
}

function toSummary(row: BookRow): BookSummary {
  const book = Book.parse(JSON.parse(row.data));
  return {
    id: book.id,
    title: book.title,
    ...(book.subtitle !== undefined ? { subtitle: book.subtitle } : {}),
    status: book.status,
    formatId: book.formatId,
    themeId: book.themeId,
    pageCount: book.pages.length,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

export const bookRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  function load(id: string): Book | undefined {
    const row = db.select().from(books).where(eq(books.id, id)).get();
    return row ? Book.parse(JSON.parse(row.data)) : undefined;
  }

  app.get('/api/books', async (): Promise<BookSummary[]> => {
    return db.select().from(books).orderBy(desc(books.updatedAt)).all().map(toSummary);
  });

  app.post('/api/books', async (request, reply) => {
    const parsed = CreateBookInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    const now = new Date().toISOString();
    const book = Book.parse({
      ...parsed.data,
      id: randomUUID(),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });
    db.insert(books)
      .values({
        id: book.id,
        title: book.title,
        status: book.status,
        data: JSON.stringify(book),
        createdAt: book.createdAt,
        updatedAt: book.updatedAt,
      })
      .run();
    return reply.code(201).send(book);
  });

  app.get('/api/books/:id', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const book = load(params.data.id);
    if (!book) return reply.notFound('Book not found');
    return book;
  });

  app.put('/api/books/:id', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const existing = load(params.data.id);
    if (!existing) return reply.notFound('Book not found');
    const parsed = Book.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    if (parsed.data.id !== params.data.id) return reply.badRequest('Body id does not match URL id');
    // createdAt is server-owned; updatedAt always advances.
    const book: Book = { ...parsed.data, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    db.update(books)
      .set({ title: book.title, status: book.status, data: JSON.stringify(book), updatedAt: book.updatedAt })
      .where(eq(books.id, book.id))
      .run();
    return book;
  });

  app.delete('/api/books/:id', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const result = db.delete(books).where(eq(books.id, params.data.id)).run();
    if (result.changes === 0) return reply.notFound('Book not found');
    return reply.code(204).send();
  });
};

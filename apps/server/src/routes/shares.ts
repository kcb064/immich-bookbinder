import { CreateShareInput, Id, UpdateShareInput, type ShareView } from '@bookbinder/shared';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SettingKeys } from '../settings.js';

const IdParams = z.object({ id: Id });
const ShareParams = z.object({ id: Id, sid: Id });

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/**
 * Origin share links are built on: the `publicUrl` setting, else `PUBLIC_URL` from the environment,
 * else the origin of this request (with a warning: that is only right on the LAN).
 */
export function publicBase(app: FastifyInstance, request: FastifyRequest): { base: string; warning?: string } {
  const configured = app.settings.get(SettingKeys.publicUrl) ?? app.config.PUBLIC_URL;
  if (configured) return { base: configured.replace(/\/+$/, '') };
  return {
    base: `${request.protocol}://${request.host}`,
    warning: 'No public URL is configured, so this link uses the address you are browsing from. Set PUBLIC_URL (or the public URL in Settings) for links that work from outside.',
  };
}

/** Admin side of sharing: list, create, update and revoke share links of a book. */
export const shareRoutes: FastifyPluginAsync = async (app) => {
  const store = app.shares;
  const views = (request: FastifyRequest, rows: ReturnType<typeof store.list>): ShareView[] => {
    const { base, warning } = publicBase(app, request);
    return rows.map((r) => store.view(r, base, warning));
  };

  app.get('/api/books/:id/shares', async (request, reply): Promise<ShareView[] | undefined> => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    if (!app.books.get(params.data.id)) return reply.notFound('Book not found');
    return views(request, store.list(params.data.id));
  });

  app.post('/api/books/:id/shares', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const body = CreateShareInput.safeParse(request.body ?? {});
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    const book = app.books.get(params.data.id);
    if (!book) return reply.notFound('Book not found');
    if (book.pages.length === 0) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Lay out the book before sharing it' });
    const row = await store.create(book.id, body.data);
    return reply.code(201).send(views(request, [row])[0]);
  });

  app.put('/api/books/:id/shares/:sid', async (request, reply) => {
    const params = ShareParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid id');
    const body = UpdateShareInput.safeParse(request.body ?? {});
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    const existing = store.get(params.data.sid);
    if (!existing || existing.bookId !== params.data.id) return reply.notFound('Share not found');
    const row = await store.update(existing.id, body.data);
    return views(request, [row!])[0];
  });

  app.delete('/api/books/:id/shares/:sid', async (request, reply) => {
    const params = ShareParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid id');
    const existing = store.get(params.data.sid);
    if (!existing || existing.bookId !== params.data.id) return reply.notFound('Share not found');
    return views(request, [store.revoke(existing.id)!])[0];
  });
};

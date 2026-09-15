import { AiSettingsInput, ForewordInput, Id, type AiJob, type AiTest, type SettingsView } from '@bookbinder/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AiServiceError } from '../ai/service.js';

const IdParams = z.object({ id: Id });
const RevertInput = z.object({ assetId: Id });

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

function sendAiError(reply: FastifyReply, err: unknown): unknown {
  if (err instanceof AiServiceError) {
    const error = err.status === 404 ? 'Not Found' : err.status === 409 ? 'Conflict' : 'Bad Request';
    return reply.code(err.status).send({ statusCode: err.status, error, message: err.message });
  }
  throw err;
}

/**
 * Claude features (M7), all opt-in:
 *   PUT/DELETE /api/settings/ai            enable, key (encrypted), model
 *   POST /api/ai/test                      one tiny request with the stored key
 *   GET  /api/books/:id/ai/jobs            jobs of a book (newest first), with usage and cost
 *   POST /api/books/:id/ai/captions        captions + chapter titles where the user typed nothing
 *   POST /api/books/:id/ai/bursts          best frame per burst of 3+; POST .../bursts/revert undoes one
 *   POST /api/books/:id/ai/foreword        title-page paragraph
 */
export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.put('/api/settings/ai', async (request, reply): Promise<SettingsView | undefined> => {
    const parsed = AiSettingsInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    app.settings.setAi(parsed.data);
    return app.settings.view();
  });

  app.delete('/api/settings/ai', async (): Promise<SettingsView> => {
    app.settings.clearAi();
    return app.settings.view();
  });

  app.post('/api/ai/test', async (): Promise<AiTest> => app.ai.test());

  app.get('/api/books/:id/ai/jobs', async (request, reply): Promise<AiJob[] | undefined> => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    if (!app.books.get(params.data.id)) return reply.notFound('Book not found');
    return app.ai.list(params.data.id);
  });

  for (const kind of ['captions', 'bursts', 'foreword'] as const) {
    app.post(`/api/books/:id/ai/${kind}`, async (request, reply) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) return reply.badRequest('Invalid book id');
      const book = app.books.get(params.data.id);
      if (!book) return reply.notFound('Book not found');
      const body = ForewordInput.safeParse(request.body ?? {});
      if (!body.success) return reply.badRequest(zodMessage(body.error));
      try {
        return reply.code(202).send(app.ai.start(book, kind, { overwrite: body.data.overwrite }));
      } catch (err) {
        return sendAiError(reply, err);
      }
    });
  }

  app.post('/api/books/:id/ai/bursts/revert', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    if (!app.books.get(params.data.id)) return reply.notFound('Book not found');
    const body = RevertInput.safeParse(request.body);
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    try {
      return { candidates: app.ai.revertBurst(params.data.id, body.data.assetId) };
    } catch (err) {
      return sendAiError(reply, err);
    }
  });
};

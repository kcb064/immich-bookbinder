import { DecisionsInput, Id, SelectionRules, StartSelectionInput, isPicked, planChapters, targetPhotosFor, type ChapterSummary, type SelectionView } from '@bookbinder/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const IdParams = z.object({ id: Id });
const RunParams = z.object({ id: Id, rid: Id });

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/**
 * Selection engine endpoints (M2).
 *   GET  /api/books/:id/selection                 candidates (chronological), summary, latest run
 *   POST /api/books/:id/selection/runs            queue a run; optional { refetch, rules }
 *   GET  /api/books/:id/selection/runs/:rid       poll a run
 *   PUT  /api/books/:id/selection/decisions       user-in / user-out / auto per photo
 */
export const selectionRoutes: FastifyPluginAsync = async (app) => {
  const store = app.books;

  function view(bookId: string, rules: SelectionRules | undefined): SelectionView {
    const assets = store.assets(bookId);
    const byId = app.candidates.map(bookId);
    // Chronological order follows the stored asset order; anything unknown to the asset list goes last.
    const ordered = assets.filter((a) => byId.has(a.id)).map((a) => byId.get(a.id)!);
    const seen = new Set(ordered.map((c) => c.assetId));
    for (const c of byId.values()) if (!seen.has(c.assetId)) ordered.push(c);
    const targetPages = rules?.targetPages ?? 48;
    const plan = planChapters(assets, { mode: rules?.chapters ?? 'auto', targetPages });
    const chapters: ChapterSummary[] = plan.map((c) => ({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle,
      total: c.photoIds.length,
      picked: c.photoIds.filter((id) => {
        const cand = byId.get(id);
        return cand ? isPicked(cand) : false;
      }).length,
    }));
    const summary = app.candidates.summary(bookId, assets, targetPhotosFor(targetPages, plan.length), plan.length);
    const run = app.selections.latest(bookId);
    return { candidates: ordered, ...(summary ? { summary } : {}), ...(run ? { run } : {}), chapters };
  }

  app.get('/api/books/:id/selection', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const book = store.get(params.data.id);
    if (!book) return reply.notFound('Book not found');
    return view(book.id, book.rules);
  });

  app.post('/api/books/:id/selection/runs', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const body = StartSelectionInput.safeParse(request.body ?? {});
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    let book = store.get(params.data.id);
    if (!book) return reply.notFound('Book not found');
    if (body.data.rules) {
      const rules = SelectionRules.safeParse(body.data.rules);
      if (!rules.success) return reply.badRequest(zodMessage(rules.error));
      book = store.save({ ...book, rules: rules.data });
    }
    if (!book.rules) return reply.badRequest('This book has no selection rules yet');
    if (!app.immichClient()) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Immich is not configured. Save a server URL and API key in Settings first.' });
    }
    const run = app.selections.start(book, { refetch: body.data.refetch });
    return reply.code(202).send(run);
  });

  app.get('/api/books/:id/selection/runs/:rid', async (request, reply) => {
    const params = RunParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid id');
    const run = app.selections.get(params.data.rid);
    if (!run || run.bookId !== params.data.id) return reply.notFound('Selection run not found');
    return run;
  });

  app.put('/api/books/:id/selection/decisions', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const body = DecisionsInput.safeParse(request.body);
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    const book = store.get(params.data.id);
    if (!book) return reply.notFound('Book not found');
    if (app.selections.active(book.id)) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'A selection run is in progress; wait for it to finish.' });
    }
    const changed = app.candidates.setDecisions(book.id, body.data.decisions);
    if (changed.length === 0) return reply.notFound('None of those photos belong to this selection');
    return view(book.id, book.rules);
  });
};

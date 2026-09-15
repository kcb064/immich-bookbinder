import { Id, ImportJobInput, LuluConnectionInput, LuluEnv, PrepareOrderInput, type LuluRemoteJob, type LuluStatus, type LuluWebhookView, type OrderView, type ReachabilityReport, type SettingsView } from '@bookbinder/shared';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { checkReachability } from '../lulu/reachability.js';
import { LuluApiError } from '../lulu/client.js';
import { OrderError } from '../lulu/orders.js';
import { LULU_WEBHOOK_PATH } from './public.js';
import { describeLuluError, testLuluConnection } from '../lulu/status.js';
import { SettingKeys } from '../settings.js';

const IdParams = z.object({ id: Id });
const OrderParams = z.object({ id: Id, oid: Id });
const SandboxInput = z.object({ sandbox: z.boolean() });
const EnvQuery = z.object({ env: LuluEnv.optional() });

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/** The configured public base (settings, else PUBLIC_URL) without a trailing slash, or undefined. */
export function configuredPublicBase(app: FastifyInstance): string | undefined {
  const configured = app.settings.get(SettingKeys.publicUrl) ?? app.config.PUBLIC_URL;
  return configured ? configured.replace(/\/+$/, '') : undefined;
}

function sendOrderError(reply: FastifyReply, err: unknown): unknown {
  if (err instanceof OrderError) {
    const error = err.status === 404 ? 'Not Found' : err.status === 409 ? 'Conflict' : err.status === 502 ? 'Bad Gateway' : 'Bad Request';
    return reply.code(err.status).send({ statusCode: err.status, error, message: err.message });
  }
  throw err;
}

/**
 * Lulu (M5): credentials in Settings, the connection test, the public-URL reachability probe, and
 * the per-book order flow (prepare -> submit -> refresh / cancel).
 */
export const luluRoutes: FastifyPluginAsync = async (app) => {
  /* ---------- Settings ---------- */

  app.put('/api/settings/lulu', async (request, reply): Promise<SettingsView | undefined> => {
    const parsed = LuluConnectionInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    app.settings.setLuluCredentials(parsed.data.env, parsed.data.clientKey, parsed.data.clientSecret);
    return app.settings.view();
  });

  app.delete('/api/settings/lulu', async (request, reply): Promise<SettingsView | undefined> => {
    const q = EnvQuery.safeParse(request.query ?? {});
    if (!q.success) return reply.badRequest(zodMessage(q.error));
    app.settings.clearLuluCredentials(q.data.env ?? app.settings.luluEnv());
    return app.settings.view();
  });

  app.put('/api/settings/lulu/sandbox', async (request, reply): Promise<SettingsView | undefined> => {
    const parsed = SandboxInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    app.settings.setLuluEnv(parsed.data.sandbox ? 'sandbox' : 'production');
    return app.settings.view();
  });

  /* ---------- Connection test and reachability ---------- */

  /** With a body: test the typed pair (not saved). Without: test the stored pair of the active (or given) environment. */
  app.post('/api/lulu/test', async (request, reply): Promise<LuluStatus | undefined> => {
    const hasBody = request.body !== undefined && request.body !== null && Object.keys(request.body as object).length > 0;
    let input: LuluConnectionInput | undefined;
    if (hasBody) {
      const parsed = LuluConnectionInput.safeParse(request.body);
      if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
      input = parsed.data;
    } else {
      input = app.settings.getLuluCredentials();
      if (!input) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: `No Lulu ${app.settings.luluEnv()} credentials are saved. Enter a client key and secret first.` });
    }
    return testLuluConnection({ ...input, baseUrl: app.config.LULU_BASE_URL });
  });

  app.post('/api/lulu/reachability', async (_request, reply): Promise<ReachabilityReport | undefined> => {
    const base = configuredPublicBase(app);
    if (!base) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'No public URL is configured. Set PUBLIC_URL or the public URL in Settings first.' });
    return checkReachability({ exports: app.exports, exportsDir: app.config.exportsDir, publicBase: base });
  });

  /* ---------- Webhooks (M7) ---------- */

  const webhookUrl = (): string | undefined => {
    const base = configuredPublicBase(app);
    return base ? `${base}${LULU_WEBHOOK_PATH}` : undefined;
  };
  const webhookView = (env: LuluEnv, hook: { id: string; url: string; is_active?: boolean; topics?: string[] }): LuluWebhookView => ({
    id: hook.id,
    url: hook.url,
    active: hook.is_active ?? true,
    topics: hook.topics ?? ['PRINT_JOB_STATUS_CHANGED'],
    env,
  });

  /** The subscription this app holds on the active environment, checked against Lulu's list (null when none). */
  app.get('/api/lulu/webhook', async (): Promise<LuluWebhookView | null | undefined> => {
    const env = app.settings.luluEnv();
    const stored = app.settings.getLuluWebhook(env);
    if (!stored) return null;
    const client = app.luluClient();
    if (!client) return webhookView(env, stored);
    try {
      const live = (await client.listWebhooks()).find((h) => h.id === stored.id);
      if (!live) {
        app.settings.setLuluWebhook(env, undefined);
        return null;
      }
      return webhookView(env, live);
    } catch (err) {
      app.log.warn({ err }, 'could not list Lulu webhooks');
      return webhookView(env, stored);
    }
  });

  app.post('/api/lulu/webhook', async (_request, reply): Promise<LuluWebhookView | undefined> => {
    const client = app.luluClient();
    if (!client) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Lulu is not configured. Save a client key and secret first.' });
    const url = webhookUrl();
    if (!url) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'No public URL is configured. Lulu needs one to reach this server.' });
    const env = app.settings.luluEnv();
    try {
      // Re-use a subscription Lulu already has for this URL (they must be unique per URL).
      const existing = (await client.listWebhooks()).find((h) => h.url === url);
      const hook = existing ?? (await client.subscribeWebhook(url));
      app.settings.setLuluWebhook(env, { id: hook.id, url: hook.url });
      return webhookView(env, hook);
    } catch (err) {
      return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: describeLuluError(err) });
    }
  });

  app.delete('/api/lulu/webhook', async (_request, reply): Promise<{ ok: true } | undefined> => {
    const env = app.settings.luluEnv();
    const stored = app.settings.getLuluWebhook(env);
    if (!stored) return { ok: true };
    const client = app.luluClient();
    try {
      if (client) await client.deleteWebhook(stored.id).catch((err: unknown) => {
        if (!(err instanceof LuluApiError && err.status === 404)) throw err;
      });
    } catch (err) {
      return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: describeLuluError(err) });
    }
    app.settings.setLuluWebhook(env, undefined);
    return { ok: true };
  });

  /** Asks Lulu to send a dummy submission; the public route logs it (nothing to update). */
  app.post('/api/lulu/webhook/test', async (_request, reply): Promise<{ ok: true } | undefined> => {
    const env = app.settings.luluEnv();
    const stored = app.settings.getLuluWebhook(env);
    const client = app.luluClient();
    if (!stored || !client) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'No webhook is subscribed.' });
    try {
      await client.testWebhook(stored.id);
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: describeLuluError(err) });
    }
  });

  /* ---------- Print jobs on Lulu (M7) ---------- */

  app.get('/api/lulu/print-jobs', async (_request, reply): Promise<LuluRemoteJob[] | undefined> => {
    try {
      return await app.orders.listRemote();
    } catch (err) {
      if (err instanceof OrderError) return sendOrderError(reply, err) as undefined;
      return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: describeLuluError(err) });
    }
  });

  app.post('/api/lulu/print-jobs/:jid/import', async (request, reply): Promise<OrderView | undefined> => {
    const params = z.object({ jid: z.string().regex(/^\d+$/) }).safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid print job id');
    const body = ImportJobInput.safeParse(request.body ?? {});
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    try {
      return await app.orders.importJob(params.data.jid, body.data.bookId);
    } catch (err) {
      if (err instanceof OrderError) return sendOrderError(reply, err) as undefined;
      return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: describeLuluError(err) });
    }
  });

  /* ---------- Orders ---------- */

  app.get('/api/orders', async (): Promise<OrderView[]> => app.orders.listAll());

  app.get('/api/books/:id/orders', async (request, reply): Promise<OrderView[] | undefined> => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    if (!app.books.get(params.data.id)) return reply.notFound('Book not found');
    return app.orders.list(params.data.id);
  });

  app.post('/api/books/:id/orders', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('Invalid book id');
    const body = PrepareOrderInput.safeParse(request.body ?? {});
    if (!body.success) return reply.badRequest(zodMessage(body.error));
    const book = app.books.get(params.data.id);
    if (!book) return reply.notFound('Book not found');
    try {
      const order = await app.orders.prepare(book, body.data);
      return reply.code(202).send(order);
    } catch (err) {
      return sendOrderError(reply, err);
    }
  });

  const orderOf = (request: { params: unknown }, reply: FastifyReply): OrderView | undefined => {
    const params = OrderParams.safeParse(request.params);
    if (!params.success) {
      void reply.badRequest('Invalid id');
      return undefined;
    }
    const order = app.orders.get(params.data.oid);
    if (!order || order.bookId !== params.data.id) {
      void reply.notFound('Order not found');
      return undefined;
    }
    return order;
  };

  app.get('/api/books/:id/orders/:oid', async (request, reply): Promise<OrderView | undefined> => orderOf(request, reply));

  for (const action of ['submit', 'refresh', 'cancel'] as const) {
    app.post(`/api/books/:id/orders/:oid/${action}`, async (request, reply): Promise<OrderView | undefined> => {
      const order = orderOf(request, reply);
      if (!order) return;
      try {
        return await app.orders[action](order.id);
      } catch (err) {
        return sendOrderError(reply, err) as undefined;
      }
    });
  }
};

import { NotificationSettingsInput, type NotificationTest, type SettingsView } from '@bookbinder/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { z } from 'zod';

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/** Settings → Notifications (M7): one ntfy topic, Gotify server or webhook URL, and a test button. */
export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.put('/api/settings/notifications', async (request, reply): Promise<SettingsView | undefined> => {
    const parsed = NotificationSettingsInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    app.settings.setNotifications(parsed.data);
    return app.settings.view();
  });

  app.delete('/api/settings/notifications', async (): Promise<SettingsView> => {
    app.settings.clearNotifications();
    return app.settings.view();
  });

  /** Sends a test message through the stored target (or the typed one, when a body is given) and reports the outcome. */
  app.post('/api/notifications/test', async (request, reply): Promise<NotificationTest | undefined> => {
    let target = app.notifier.currentTarget();
    if (request.body && typeof request.body === 'object' && Object.keys(request.body).length > 0) {
      const parsed = NotificationSettingsInput.safeParse(request.body);
      if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
      const stored = app.settings.getNotifications();
      const token = parsed.data.token === undefined ? stored?.token : parsed.data.token || undefined;
      target = { kind: parsed.data.kind, url: parsed.data.url, token, events: parsed.data.events };
    }
    if (!target) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Notifications are not configured. Save a URL first.' });
    const result = await app.notifier.deliver({ kind: 'test', title: 'Bookbinder', message: 'Test notification: this is where render, order and selection news will arrive.', path: '/' }, target);
    return { ok: result.ok, ...(result.status !== undefined ? { status: result.status } : {}), ...(result.error ? { error: result.error } : {}) };
  });
};

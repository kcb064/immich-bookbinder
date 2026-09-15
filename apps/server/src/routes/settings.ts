import { ImmichConnectionInput, PetsInput, type SettingsView } from '@bookbinder/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SettingKeys } from '../settings.js';

const PublicUrlInput = z.object({
  publicUrl: z.url({ error: 'publicUrl must be an absolute URL' }).nullable(),
});

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/settings', async (): Promise<SettingsView> => app.settings.view());

  app.put('/api/settings/immich', async (request, reply) => {
    const parsed = ImmichConnectionInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    app.settings.setImmichConnection(parsed.data);
    return app.settings.view();
  });

  app.delete('/api/settings/immich', async () => {
    app.settings.delete(SettingKeys.immichUrl, SettingKeys.immichApiKey);
    return app.settings.view();
  });

  /** Replaces the saved pets (M7). */
  app.put('/api/settings/pets', async (request, reply) => {
    const parsed = PetsInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    const ids = new Set(parsed.data.pets.map((p) => p.id));
    if (ids.size !== parsed.data.pets.length) return reply.badRequest('pets: ids must be unique');
    app.settings.setPets(parsed.data.pets);
    return app.settings.view();
  });

  app.put('/api/settings/public-url', async (request, reply) => {
    const parsed = PublicUrlInput.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(zodMessage(parsed.error));
    if (parsed.data.publicUrl === null) app.settings.delete(SettingKeys.publicUrl);
    else app.settings.set(SettingKeys.publicUrl, parsed.data.publicUrl.replace(/\/+$/, ''));
    return app.settings.view();
  });
};

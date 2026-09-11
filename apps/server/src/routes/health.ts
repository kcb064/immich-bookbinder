import type { Health } from '@bookbinder/shared';
import type { FastifyPluginAsync } from 'fastify';
import pkg from '../../package.json' with { type: 'json' };

export const APP_VERSION: string = pkg.version;

export const healthRoutes: FastifyPluginAsync = async (app) => {
  const startedAt = Date.now();
  app.get('/api/health', async (): Promise<Health> => ({
    status: 'ok',
    version: APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));
};

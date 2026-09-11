import type { FastifyPluginAsync } from 'fastify';

/**
 * Placeholder for the unauthenticated public surface (shared book viewer at /s/:token
 * and its assets under /public/*). These prefixes are deliberately outside the /api auth
 * guard; until the viewer ships they answer 404.
 */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const notYet = async () => ({
    statusCode: 404,
    error: 'Not Found',
    message: 'Public sharing is not available yet',
  });
  for (const prefix of ['/s', '/public']) {
    app.get(prefix, async (_req, reply) => reply.code(404).send(await notYet()));
    app.get(`${prefix}/*`, async (_req, reply) => reply.code(404).send(await notYet()));
  }
};

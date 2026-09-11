import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Serves the built web app (WEB_DIST) and falls back to index.html for any GET that is
 * not an API/public route, so client-side routing works on refresh. Only registered when
 * WEB_DIST/index.html exists.
 */
export const staticRoutes: FastifyPluginAsync<{ root: string }> = async (app, opts) => {
  await app.register(fastifyStatic, {
    root: opts.root,
    prefix: '/',
    wildcard: true,
    index: ['index.html'],
    cacheControl: true,
    maxAge: '1h',
    immutable: false,
  });

  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    const isApi = path === '/api' || path.startsWith('/api/');
    const isPublic = path.startsWith('/s/') || path === '/s' || path.startsWith('/public/') || path === '/public';
    if (request.method === 'GET' && !isApi && !isPublic) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: `Route ${request.method}:${path} not found` });
  });
};

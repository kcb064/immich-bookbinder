import { LoginRequest } from '@bookbinder/shared';
import type { FastifyPluginAsync } from 'fastify';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  setSessionCookie,
  verifyAdminPassword,
} from '../auth.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = LoginRequest.safeParse(request.body);
      if (!parsed.success) return reply.badRequest('Body must be {"password": string}');
      const ok = await verifyAdminPassword(app.config, parsed.data.password);
      if (!ok) return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Wrong password' });
      const session = createSession(app.db);
      setSessionCookie(app, reply, session.id);
      return { authenticated: true, via: 'session' as const };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.auth.sessionId) deleteSession(app.db, request.auth.sessionId);
    clearSessionCookie(app, reply);
    return { authenticated: false, via: null };
  });

  app.get('/api/auth/me', async (request) => {
    return { authenticated: request.auth.authenticated, via: request.auth.via };
  });
};

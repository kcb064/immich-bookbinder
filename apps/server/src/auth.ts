import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { sessions } from './db/schema.js';

export const SESSION_COOKIE = 'bb_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CF_ACCESS_HEADER = 'cf-access-authenticated-user-email';

export type AuthVia = 'session' | 'cf-access' | null;
export interface AuthState {
  authenticated: boolean;
  via: AuthVia;
  sessionId?: string;
}

/** Constant-time comparison of two strings regardless of length (compares SHA-256 digests). */
function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

export async function verifyAdminPassword(config: Config, password: string): Promise<boolean> {
  if (config.ADMIN_PASSWORD_HASH) {
    try {
      return await argon2.verify(config.ADMIN_PASSWORD_HASH, password);
    } catch {
      return false;
    }
  }
  if (config.ADMIN_PASSWORD) return safeEqual(config.ADMIN_PASSWORD, password);
  return false;
}

export function createSession(db: Db, now = Date.now()): { id: string; expiresAt: Date } {
  const id = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now + SESSION_TTL_MS);
  db.insert(sessions).values({ id, createdAt: new Date(now), expiresAt }).run();
  // Opportunistic cleanup so the table does not grow unbounded.
  db.delete(sessions).where(lt(sessions.expiresAt, new Date(now))).run();
  return { id, expiresAt };
}

export function findValidSession(db: Db, id: string, now = Date.now()): boolean {
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  return row !== undefined && row.expiresAt.getTime() > now;
}

export function deleteSession(db: Db, id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export function resolveAuth(app: FastifyInstance, request: FastifyRequest): AuthState {
  if (app.config.TRUST_CF_ACCESS) {
    const email = request.headers[CF_ACCESS_HEADER];
    if (typeof email === 'string' && email.length > 0) return { authenticated: true, via: 'cf-access' };
  }
  const raw = request.cookies[SESSION_COOKIE];
  if (raw) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid && unsigned.value && findValidSession(app.db, unsigned.value)) {
      return { authenticated: true, via: 'session', sessionId: unsigned.value };
    }
  }
  return { authenticated: false, via: null };
}

export function setSessionCookie(_app: FastifyInstance, reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // 'auto': Secure only when this request came over HTTPS (directly, or via X-Forwarded-Proto behind
    // the tunnel). A fixed flag derived from PUBLIC_URL locked people out on plain http://nas:3080.
    secure: 'auto',
    signed: true,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(_app: FastifyInstance, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
  });
}

const PUBLIC_API_PATHS = ['/api/health'];
const PUBLIC_API_PREFIXES = ['/api/auth/'];

export function requiresAuth(path: string): boolean {
  if (!(path === '/api' || path.startsWith('/api/'))) return false;
  if (PUBLIC_API_PATHS.includes(path)) return false;
  return !PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Attaches `request.auth` to every request and rejects unauthenticated calls to
 * /api/* except /api/health and /api/auth/*. Non-API paths (/s/*, /public/*, the SPA) are left alone.
 * Must run after @fastify/cookie is registered.
 */
export function registerAuth(app: FastifyInstance): void {
  // Declared up front so V8 keeps one hidden class per request; the hook below always assigns it.
  app.decorateRequest('auth', null as unknown as AuthState);
  app.addHook('onRequest', async (request, reply) => {
    request.auth = resolveAuth(app, request);
    const path = request.url.split('?')[0] ?? request.url;
    if (requiresAuth(path) && !request.auth.authenticated) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Login required' });
    }
  });
}

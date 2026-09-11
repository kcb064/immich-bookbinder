import './types.js';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { mkdirSync } from 'node:fs';
import { registerAuth } from './auth.js';
import type { Config } from './config.js';
import { SecretBox } from './crypto.js';
import { openDb } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { bookRoutes } from './routes/books.js';
import { healthRoutes } from './routes/health.js';
import { immichRoutes } from './routes/immich.js';
import { publicRoutes } from './routes/public.js';
import { settingsRoutes } from './routes/settings.js';
import { staticRoutes } from './routes/static.js';
import { SettingsStore } from './settings.js';

type LoggerOption = NonNullable<FastifyServerOptions['logger']>;

export interface BuildAppOptions {
  /** Override Fastify's logger (tests pass `false`). */
  logger?: LoggerOption;
}

function loggerFor(config: Config): LoggerOption {
  if (config.isTest) return false;
  if (config.isProduction) return { level: config.LOG_LEVEL };
  return {
    level: config.LOG_LEVEL,
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  };
}

export async function buildApp(config: Config, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  for (const dir of [config.dataDir, config.cacheDir, config.exportsDir]) mkdirSync(dir, { recursive: true });

  const database = openDb(config.dbFile);
  const secrets = new SecretBox(config.SECRET_KEY);
  const settings = new SettingsStore(database.db, secrets);

  const app = Fastify({
    logger: opts.logger ?? loggerFor(config),
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  app.decorate('config', config);
  app.decorate('db', database.db);
  app.decorate('secrets', secrets);
  app.decorate('settings', settings);
  app.addHook('onClose', async () => database.close());

  await app.register(fastifySensible);
  await app.register(fastifyHelmet, {
    // Thumbnails are proxied through this origin, so a strict self-only policy works for the SPA.
    contentSecurityPolicy: config.isProduction
      ? {
          useDefaults: false,
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
            'img-src': ["'self'", 'data:', 'blob:'],
            'connect-src': ["'self'"],
            'object-src': ["'none'"],
            'base-uri': ["'self'"],
            'frame-ancestors': ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(fastifyCookie, { secret: config.SECRET_KEY, hook: 'onRequest' });
  await app.register(fastifyRateLimit, { global: false });

  registerAuth(app);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(settingsRoutes);
  await app.register(immichRoutes);
  await app.register(bookRoutes);
  await app.register(publicRoutes);
  if (config.webDist) {
    await app.register(staticRoutes, { root: config.webDist });
    app.log.info({ webDist: config.webDist }, 'serving web app');
  } else {
    app.log.info({ webDist: config.WEB_DIST }, 'web app build not found; API-only mode');
  }

  return app;
}

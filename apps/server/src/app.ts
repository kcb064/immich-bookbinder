import './types.js';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { mkdirSync } from 'node:fs';
import { registerAuth } from './auth.js';
import { BookStore } from './books/store.js';
import type { Config } from './config.js';
import { SecretBox } from './crypto.js';
import { openDb } from './db/index.js';
import { createImmichClient, type ImmichClient } from './immich/client.js';
import { ChromiumRenderer } from './render/renderer.js';
import { RenderService } from './render/service.js';
import { SelectionService } from './selection/service.js';
import { CandidateStore } from './selection/store.js';
import { authRoutes } from './routes/auth.js';
import { bookRoutes } from './routes/books.js';
import { healthRoutes } from './routes/health.js';
import { immichRoutes } from './routes/immich.js';
import { publicRoutes } from './routes/public.js';
import { selectionRoutes } from './routes/selection.js';
import { settingsRoutes } from './routes/settings.js';
import { staticRoutes } from './routes/static.js';
import { SettingsStore } from './settings.js';

type LoggerOption = NonNullable<FastifyServerOptions['logger']>;

export interface BuildAppOptions {
  /** Override Fastify's logger (tests pass `false`). */
  logger?: LoggerOption;
  /** Render tuning (tests use small batches and no web fonts). */
  render?: { batchSize?: number; webFonts?: boolean };
  /** Selection tuning (tests cap the analysis workers). */
  selection?: { concurrency?: number };
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

  const books = new BookStore(database.db);
  // One client per stored connection so per-connection caches (image store) stay warm.
  let cachedClient: { key: string; client: ImmichClient } | undefined;
  const immichClient = (): ImmichClient | undefined => {
    const conn = settings.getImmichConnection();
    if (!conn) return undefined;
    const key = `${conn.url}
${conn.apiKey}`;
    if (cachedClient?.key !== key) cachedClient = { key, client: createImmichClient(conn) };
    return cachedClient.client;
  };
  const renderer = new ChromiumRenderer();

  app.decorate('config', config);
  app.decorate('db', database.db);
  app.decorate('secrets', secrets);
  app.decorate('settings', settings);
  const candidates = new CandidateStore(database.db);
  app.decorate('books', books);
  app.decorate('candidates', candidates);
  app.decorate('immichClient', immichClient);
  app.decorate(
    'selections',
    new SelectionService({
      db: database.db,
      store: books,
      candidates,
      client: immichClient,
      cacheDir: config.cacheDir,
      log: app.log,
      ...(opts.selection?.concurrency !== undefined ? { concurrency: opts.selection.concurrency } : {}),
    }),
  );
  app.decorate(
    'renders',
    new RenderService({
      db: database.db,
      store: books,
      renderer,
      client: immichClient,
      exportsDir: config.exportsDir,
      cacheDir: config.cacheDir,
      log: app.log,
      ...(opts.render?.batchSize !== undefined ? { batchSize: opts.render.batchSize } : {}),
      ...(opts.render?.webFonts !== undefined ? { webFonts: opts.render.webFonts } : {}),
    }),
  );
  app.addHook('onClose', async () => {
    await renderer.close();
    database.close();
  });

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
  await app.register(selectionRoutes);
  await app.register(publicRoutes);
  if (config.webDist) {
    await app.register(staticRoutes, { root: config.webDist });
    app.log.info({ webDist: config.webDist }, 'serving web app');
  } else {
    app.log.info({ webDist: config.WEB_DIST }, 'web app build not found; API-only mode');
  }

  return app;
}

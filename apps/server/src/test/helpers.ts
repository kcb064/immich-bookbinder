import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig, type Config } from '../config.js';

export const TEST_SECRET = 'test-secret-key-0123456789abcdef0123456789abcdef';
export const TEST_PASSWORD = 'correct horse battery staple';

export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    SECRET_KEY: TEST_SECRET,
    ADMIN_PASSWORD: TEST_PASSWORD,
    // Point at a folder without index.html so static serving stays off.
    WEB_DIST: join(tmpdir(), 'bookbinder-no-web-dist'),
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  config: Config;
  dataDir: string;
  cleanup(): Promise<void>;
}

/** Builds an app against a fresh temp DATA_DIR; call cleanup() in afterAll. */
export async function createTestApp(envOverrides: Record<string, string | undefined> = {}, opts: Omit<BuildAppOptions, 'logger'> = {}): Promise<TestApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'bookbinder-test-'));
  const config = loadConfig(testEnv({ DATA_DIR: dataDir, ...envOverrides }));
  const app = await buildApp(config, { logger: false, ...opts });
  await app.ready();
  return {
    app,
    config,
    dataDir,
    cleanup: async () => {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

let loginCounter = 0;

/** Logs in and returns the Cookie header value. Each call uses a fresh client IP so the 5/min login limit is not tripped. */
export async function loginCookie(app: FastifyInstance, password = TEST_PASSWORD): Promise<string> {
  loginCounter += 1;
  const remoteAddress = `10.0.${Math.floor(loginCounter / 250)}.${(loginCounter % 250) + 1}`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password }, remoteAddress });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'bb_session');
  if (!cookie) throw new Error('no bb_session cookie set');
  return `${cookie.name}=${cookie.value}`;
}

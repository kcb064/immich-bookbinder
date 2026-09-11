import type { AuthState } from './auth.js';
import type { Config } from './config.js';
import type { SecretBox } from './crypto.js';
import type { Db } from './db/index.js';
import type { SettingsStore } from './settings.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    secrets: SecretBox;
    settings: SettingsStore;
  }
  interface FastifyRequest {
    auth: AuthState;
  }
}

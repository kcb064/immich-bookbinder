import type { AuthState } from './auth.js';
import type { BookStore } from './books/store.js';
import type { Config } from './config.js';
import type { SecretBox } from './crypto.js';
import type { Db } from './db/index.js';
import type { ImmichClient } from './immich/client.js';
import type { RenderService } from './render/service.js';
import type { SelectionService } from './selection/service.js';
import type { CandidateStore } from './selection/store.js';
import type { SettingsStore } from './settings.js';
import type { ShareStore } from './shares/store.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    secrets: SecretBox;
    settings: SettingsStore;
    books: BookStore;
    renders: RenderService;
    candidates: CandidateStore;
    selections: SelectionService;
    shares: ShareStore;
    /** Client for the stored Immich connection, or undefined until Settings has a URL and key. */
    immichClient: () => ImmichClient | undefined;
  }
  interface FastifyRequest {
    auth: AuthState;
  }
}

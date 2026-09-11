import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
/** Works from both src/ (tsx dev) and dist/ (bundled): both are one level below apps/server. */
const defaultWebDist = resolve(here, '../../web/dist');

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : /^(1|true|yes|on)$/i.test(v.trim())));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3080),
    HOST: z.string().min(1).default('0.0.0.0'),
    DATA_DIR: z.string().min(1).default('./data'),
    SECRET_KEY: z
      .string({ error: 'SECRET_KEY is required (a random string of at least 32 characters)' })
      .min(32, 'SECRET_KEY must be at least 32 characters'),
    ADMIN_PASSWORD: z.string().min(1).optional(),
    ADMIN_PASSWORD_HASH: z
      .string()
      .regex(/^\$argon2(id|i|d)\$/, 'ADMIN_PASSWORD_HASH must be an argon2 PHC string ($argon2id$...)')
      .optional(),
    PUBLIC_URL: z.url({ error: 'PUBLIC_URL must be an absolute URL, e.g. https://books.example.com' }).optional(),
    TRUST_CF_ACCESS: bool.default(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    WEB_DIST: z.string().min(1).default(defaultWebDist),
  })
  .refine((e) => e.ADMIN_PASSWORD !== undefined || e.ADMIN_PASSWORD_HASH !== undefined, {
    message: 'One of ADMIN_PASSWORD or ADMIN_PASSWORD_HASH is required',
    path: ['ADMIN_PASSWORD'],
  });

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  /** Absolute path of DATA_DIR. */
  dataDir: string;
  dbFile: string;
  cacheDir: string;
  exportsDir: string;
  /** Absolute WEB_DIST, or undefined when the folder does not exist (API-only mode). */
  webDist: string | undefined;
  cookieSecure: boolean;
  isProduction: boolean;
  isTest: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Empty strings from .env files count as unset. */
function stripEmpty(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(stripEmpty(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new ConfigError(`Invalid server configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const dataDir = resolve(e.DATA_DIR);
  const webDistAbs = resolve(e.WEB_DIST);
  return {
    ...e,
    dataDir,
    dbFile: resolve(dataDir, 'bookbinder.sqlite'),
    cacheDir: resolve(dataDir, 'cache'),
    exportsDir: resolve(dataDir, 'exports'),
    webDist: existsSync(resolve(webDistAbs, 'index.html')) ? webDistAbs : undefined,
    cookieSecure: e.PUBLIC_URL?.startsWith('https://') ?? false,
    isProduction: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',
  };
}

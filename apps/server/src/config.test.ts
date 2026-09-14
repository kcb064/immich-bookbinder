import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';
import { testEnv } from './test/helpers.js';

describe('loadConfig', () => {
  it('fails fast with a readable message when SECRET_KEY is missing', () => {
    expect(() => loadConfig(testEnv({ SECRET_KEY: undefined }))).toThrowError(ConfigError);
    expect(() => loadConfig(testEnv({ SECRET_KEY: undefined }))).toThrowError(/SECRET_KEY is required/);
  });

  it('rejects a short SECRET_KEY', () => {
    expect(() => loadConfig(testEnv({ SECRET_KEY: 'too-short' }))).toThrowError(/at least 32 characters/);
  });

  it('requires ADMIN_PASSWORD or ADMIN_PASSWORD_HASH', () => {
    expect(() => loadConfig(testEnv({ ADMIN_PASSWORD: undefined }))).toThrowError(/ADMIN_PASSWORD or ADMIN_PASSWORD_HASH/);
    const cfg = loadConfig(
      testEnv({ ADMIN_PASSWORD: undefined, ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def' }),
    );
    expect(cfg.ADMIN_PASSWORD_HASH).toMatch(/^\$argon2id\$/);
  });

  it('applies defaults and derives paths', () => {
    const cfg = loadConfig(testEnv({ DATA_DIR: './tmp-data' }));
    expect(cfg.PORT).toBe(3080);
    expect(cfg.HOST).toBe('0.0.0.0');
    expect(cfg.TRUST_CF_ACCESS).toBe(false);
    expect(cfg.dbFile.replace(/\\/g, '/')).toMatch(/tmp-data\/bookbinder\.sqlite$/);
    expect(cfg.cacheDir.replace(/\\/g, '/')).toMatch(/tmp-data\/cache$/);
    expect(cfg.webDist).toBeUndefined();
  });

  it('parses booleans, ports and PUBLIC_URL', () => {
    const cfg = loadConfig(testEnv({ PORT: '4000', TRUST_CF_ACCESS: 'true', PUBLIC_URL: 'https://books.example.com' }));
    expect(cfg.PORT).toBe(4000);
    expect(cfg.TRUST_CF_ACCESS).toBe(true);
    expect(() => loadConfig(testEnv({ PUBLIC_URL: 'not a url' }))).toThrowError(/PUBLIC_URL/);
    expect(() => loadConfig(testEnv({ PORT: '99999' }))).toThrowError(/PORT/);
  });
});

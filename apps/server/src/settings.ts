import { ImmichConnectionInput, ShippingAddress, type LuluEnv, type SettingsView } from '@bookbinder/shared';
import { eq } from 'drizzle-orm';
import type { SecretBox } from './crypto.js';
import type { Db } from './db/index.js';
import { settings } from './db/schema.js';

export const SettingKeys = {
  immichUrl: 'immich.url',
  immichApiKey: 'immich.apiKey',
  publicUrl: 'publicUrl',
  luluSandbox: 'lulu.sandbox',
  luluSandboxClientKey: 'lulu.sandbox.clientKey',
  luluSandboxClientSecret: 'lulu.sandbox.clientSecret',
  luluProductionClientKey: 'lulu.production.clientKey',
  luluProductionClientSecret: 'lulu.production.clientSecret',
  luluLastAddress: 'lulu.lastAddress',
  aiEnabled: 'ai.enabled',
  aiApiKey: 'ai.apiKey',
} as const;
export type SettingKey = (typeof SettingKeys)[keyof typeof SettingKeys];

/** Typed access to the key/value `settings` table; secret values are encrypted at rest. */
export class SettingsStore {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
  ) {}

  get(key: SettingKey): string | undefined {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return undefined;
    return row.encrypted ? this.secrets.decrypt(row.value) : row.value;
  }

  set(key: SettingKey, value: string, opts: { secret?: boolean } = {}): void {
    const encrypted = opts.secret === true;
    const stored = encrypted ? this.secrets.encrypt(value) : value;
    const updatedAt = new Date().toISOString();
    this.db
      .insert(settings)
      .values({ key, value: stored, encrypted, updatedAt })
      .onConflictDoUpdate({ target: settings.key, set: { value: stored, encrypted, updatedAt } })
      .run();
  }

  delete(...keys: SettingKey[]): void {
    for (const key of keys) this.db.delete(settings).where(eq(settings.key, key)).run();
  }

  /** Stored Immich connection, or undefined until both url and API key are configured. */
  getImmichConnection(): ImmichConnectionInput | undefined {
    const url = this.get(SettingKeys.immichUrl);
    const apiKey = this.get(SettingKeys.immichApiKey);
    if (!url || !apiKey) return undefined;
    const parsed = ImmichConnectionInput.safeParse({ url, apiKey });
    return parsed.success ? parsed.data : undefined;
  }

  setImmichConnection(input: ImmichConnectionInput): void {
    this.set(SettingKeys.immichUrl, input.url.replace(/\/+$/, ''));
    this.set(SettingKeys.immichApiKey, input.apiKey, { secret: true });
  }

  /* ---------- Lulu (M5) ---------- */

  /** Which Lulu environment the app talks to; sandbox until production is chosen on purpose. */
  luluEnv(): LuluEnv {
    return (this.get(SettingKeys.luluSandbox) ?? 'true') !== 'false' ? 'sandbox' : 'production';
  }

  setLuluEnv(env: LuluEnv): void {
    this.set(SettingKeys.luluSandbox, env === 'sandbox' ? 'true' : 'false');
  }

  private static luluKeys(env: LuluEnv): { key: SettingKey; secret: SettingKey } {
    return env === 'sandbox'
      ? { key: SettingKeys.luluSandboxClientKey, secret: SettingKeys.luluSandboxClientSecret }
      : { key: SettingKeys.luluProductionClientKey, secret: SettingKeys.luluProductionClientSecret };
  }

  /** The stored key/secret pair of one environment (default: the active one), or undefined until both are set. */
  getLuluCredentials(env: LuluEnv = this.luluEnv()): { env: LuluEnv; clientKey: string; clientSecret: string } | undefined {
    const keys = SettingsStore.luluKeys(env);
    const clientKey = this.get(keys.key);
    const clientSecret = this.get(keys.secret);
    if (!clientKey || !clientSecret) return undefined;
    return { env, clientKey, clientSecret };
  }

  setLuluCredentials(env: LuluEnv, clientKey: string, clientSecret: string): void {
    const keys = SettingsStore.luluKeys(env);
    this.set(keys.key, clientKey, { secret: true });
    this.set(keys.secret, clientSecret, { secret: true });
  }

  clearLuluCredentials(env: LuluEnv): void {
    const keys = SettingsStore.luluKeys(env);
    this.delete(keys.key, keys.secret);
  }

  getLastAddress(): ShippingAddress | undefined {
    const raw = this.get(SettingKeys.luluLastAddress);
    if (!raw) return undefined;
    try {
      const parsed = ShippingAddress.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  setLastAddress(address: ShippingAddress): void {
    this.set(SettingKeys.luluLastAddress, JSON.stringify(address));
  }

  /** Public view: never includes secret values, only whether they are set. */
  view(): SettingsView {
    const publicUrl = this.get(SettingKeys.publicUrl);
    const immichUrl = this.get(SettingKeys.immichUrl);
    const luluEnv = this.luluEnv();
    const sandboxKeySet = this.getLuluCredentials('sandbox') !== undefined;
    const productionKeySet = this.getLuluCredentials('production') !== undefined;
    const lastAddress = this.getLastAddress();
    return {
      immich: {
        ...(immichUrl !== undefined ? { url: immichUrl } : {}),
        apiKeySet: this.get(SettingKeys.immichApiKey) !== undefined,
      },
      lulu: {
        sandbox: luluEnv === 'sandbox',
        clientKeySet: luluEnv === 'sandbox' ? sandboxKeySet : productionKeySet,
        sandboxKeySet,
        productionKeySet,
        ...(lastAddress ? { lastAddress } : {}),
      },
      ai: {
        enabled: this.get(SettingKeys.aiEnabled) === 'true',
        apiKeySet: this.get(SettingKeys.aiApiKey) !== undefined,
      },
      ...(publicUrl !== undefined ? { publicUrl } : {}),
    };
  }
}

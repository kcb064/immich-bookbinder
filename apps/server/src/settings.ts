import { ImmichConnectionInput, type SettingsView } from '@bookbinder/shared';
import { eq } from 'drizzle-orm';
import type { SecretBox } from './crypto.js';
import type { Db } from './db/index.js';
import { settings } from './db/schema.js';

export const SettingKeys = {
  immichUrl: 'immich.url',
  immichApiKey: 'immich.apiKey',
  publicUrl: 'publicUrl',
  luluSandbox: 'lulu.sandbox',
  luluClientKey: 'lulu.clientKey',
  luluClientSecret: 'lulu.clientSecret',
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

  /** Public view: never includes secret values, only whether they are set. */
  view(): SettingsView {
    const publicUrl = this.get(SettingKeys.publicUrl);
    const immichUrl = this.get(SettingKeys.immichUrl);
    return {
      immich: {
        ...(immichUrl !== undefined ? { url: immichUrl } : {}),
        apiKeySet: this.get(SettingKeys.immichApiKey) !== undefined,
      },
      lulu: {
        sandbox: (this.get(SettingKeys.luluSandbox) ?? 'true') !== 'false',
        clientKeySet: this.get(SettingKeys.luluClientKey) !== undefined,
      },
      ai: {
        enabled: this.get(SettingKeys.aiEnabled) === 'true',
        apiKeySet: this.get(SettingKeys.aiApiKey) !== undefined,
      },
      ...(publicUrl !== undefined ? { publicUrl } : {}),
    };
  }
}

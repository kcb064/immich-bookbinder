import { DEFAULT_AI_MODEL, ImmichConnectionInput, NotificationEvents, NotifyKind, SavedPet, ShippingAddress, type AiSettingsInput, type LuluEnv, type NotificationSettingsInput, type NotificationSettingsView, type SettingsView } from '@bookbinder/shared';
import { z } from 'zod';
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
  luluSandboxWebhook: 'lulu.sandbox.webhook',
  luluProductionWebhook: 'lulu.production.webhook',
  aiEnabled: 'ai.enabled',
  aiApiKey: 'ai.apiKey',
  aiModel: 'ai.model',
  pets: 'pets',
  notifyKind: 'notify.kind',
  notifyUrl: 'notify.url',
  notifyToken: 'notify.token',
  notifyEvents: 'notify.events',
} as const;
export type SettingKey = (typeof SettingKeys)[keyof typeof SettingKeys];

function notificationsView(n: (NotificationSettingsView & { token?: string }) | undefined): NotificationSettingsView {
  if (!n) return { configured: false, tokenSet: false, events: NotificationEvents.parse({}) };
  return { configured: n.configured, kind: n.kind, url: n.url, tokenSet: n.tokenSet, events: n.events };
}

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

  /** The webhook subscription this app made on an environment (id + url), if any (M7). */
  getLuluWebhook(env: LuluEnv): { id: string; url: string } | undefined {
    const raw = this.get(env === 'sandbox' ? SettingKeys.luluSandboxWebhook : SettingKeys.luluProductionWebhook);
    if (!raw) return undefined;
    try {
      const v = JSON.parse(raw) as { id?: unknown; url?: unknown };
      return typeof v.id === 'string' && typeof v.url === 'string' ? { id: v.id, url: v.url } : undefined;
    } catch {
      return undefined;
    }
  }

  setLuluWebhook(env: LuluEnv, hook: { id: string; url: string } | undefined): void {
    const key = env === 'sandbox' ? SettingKeys.luluSandboxWebhook : SettingKeys.luluProductionWebhook;
    if (hook) this.set(key, JSON.stringify(hook));
    else this.delete(key);
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

  /* ---------- Claude (M7) ---------- */

  /** The AI configuration; `apiKey` is present only when stored. */
  getAi(): { enabled: boolean; apiKey?: string; model: string } {
    const apiKey = this.get(SettingKeys.aiApiKey);
    return {
      enabled: this.get(SettingKeys.aiEnabled) === 'true',
      ...(apiKey !== undefined ? { apiKey } : {}),
      model: this.get(SettingKeys.aiModel) ?? DEFAULT_AI_MODEL,
    };
  }

  setAi(input: AiSettingsInput): void {
    this.set(SettingKeys.aiEnabled, input.enabled ? 'true' : 'false');
    if (input.model !== undefined) this.set(SettingKeys.aiModel, input.model);
    if (input.apiKey === '') this.delete(SettingKeys.aiApiKey);
    else if (input.apiKey !== undefined) this.set(SettingKeys.aiApiKey, input.apiKey, { secret: true });
  }

  clearAi(): void {
    this.delete(SettingKeys.aiEnabled, SettingKeys.aiApiKey, SettingKeys.aiModel);
  }

  /* ---------- Pets (M7) ---------- */

  getPets(): SavedPet[] {
    const raw = this.get(SettingKeys.pets);
    if (!raw) return [];
    try {
      const parsed = z.array(SavedPet).safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  setPets(pets: readonly SavedPet[]): void {
    this.set(SettingKeys.pets, JSON.stringify(pets));
  }

  /* ---------- Notifications (M7) ---------- */

  getNotifications(): (NotificationSettingsView & { token?: string }) | undefined {
    const kind = NotifyKind.safeParse(this.get(SettingKeys.notifyKind));
    const url = this.get(SettingKeys.notifyUrl);
    if (!kind.success || !url) return undefined;
    const token = this.get(SettingKeys.notifyToken);
    let events = NotificationEvents.parse({});
    try {
      const parsed = NotificationEvents.safeParse(JSON.parse(this.get(SettingKeys.notifyEvents) ?? '{}'));
      if (parsed.success) events = parsed.data;
    } catch {
      /* defaults */
    }
    return { configured: true, kind: kind.data, url, tokenSet: token !== undefined, events, ...(token !== undefined ? { token } : {}) };
  }

  setNotifications(input: NotificationSettingsInput): void {
    this.set(SettingKeys.notifyKind, input.kind);
    this.set(SettingKeys.notifyUrl, input.url.replace(/\/+$/, ''));
    this.set(SettingKeys.notifyEvents, JSON.stringify(input.events));
    if (input.token === '') this.delete(SettingKeys.notifyToken);
    else if (input.token !== undefined) this.set(SettingKeys.notifyToken, input.token, { secret: true });
  }

  clearNotifications(): void {
    this.delete(SettingKeys.notifyKind, SettingKeys.notifyUrl, SettingKeys.notifyToken, SettingKeys.notifyEvents);
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
        model: this.get(SettingKeys.aiModel) ?? DEFAULT_AI_MODEL,
      },
      pets: this.getPets(),
      notifications: notificationsView(this.getNotifications()),
      ...(publicUrl !== undefined ? { publicUrl } : {}),
    };
  }
}

import { z } from 'zod';

/** Request/response shapes shared by apps/server and apps/web. */

export const LoginRequest = z.object({ password: z.string().min(1) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const ImmichConnectionInput = z.object({
  /** Base URL without /api, e.g. http://immich_server:2283 */
  url: z.url(),
  apiKey: z.string().min(10),
});
export type ImmichConnectionInput = z.infer<typeof ImmichConnectionInput>;

export const PermissionProbe = z.object({
  permission: z.string(),
  ok: z.boolean(),
  detail: z.string().optional(),
});
export type PermissionProbe = z.infer<typeof PermissionProbe>;

export const ImmichStatus = z.object({
  connected: z.boolean(),
  url: z.string().optional(),
  serverVersion: z.string().optional(),
  /** Immich version the app was built against. */
  supportedVersion: z.string(),
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }).optional(),
  photos: z.number().int().optional(),
  people: z.number().int().optional(),
  albums: z.number().int().optional(),
  permissions: z.array(PermissionProbe).default([]),
  error: z.string().optional(),
});
export type ImmichStatus = z.infer<typeof ImmichStatus>;

export const SettingsView = z.object({
  immich: z.object({ url: z.string().optional(), apiKeySet: z.boolean() }),
  lulu: z.object({ sandbox: z.boolean(), clientKeySet: z.boolean() }),
  ai: z.object({ enabled: z.boolean(), apiKeySet: z.boolean() }),
  publicUrl: z.string().optional(),
});
export type SettingsView = z.infer<typeof SettingsView>;

export const Health = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number(),
});
export type Health = z.infer<typeof Health>;

/** Immich API key permissions this app needs (documented in docs/immich-setup.md). */
export const REQUIRED_IMMICH_PERMISSIONS = [
  'server.about',
  'user.read',
  'asset.read',
  'asset.view',
  'asset.download',
  'asset.statistics',
  'album.read',
  'person.read',
  'face.read',
  'duplicate.read',
  'tag.read',
  'timeline.read',
  'map.read',
] as const;
export type RequiredImmichPermission = (typeof REQUIRED_IMMICH_PERMISSIONS)[number];

/** Immich server version the vendored OpenAPI spec (specs/immich-openapi.json) describes. */
export const SUPPORTED_IMMICH_VERSION = '3.2.0';

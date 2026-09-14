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

/* ---------- Print readiness (M4) ---------- */

export const PreflightCode = z.enum([
  'page-count',
  'empty-slot',
  'low-resolution',
  'caption-safety',
  'cover-missing',
  'cover-stale',
  'render-missing',
]);
export type PreflightCode = z.infer<typeof PreflightCode>;

export const PreflightItem = z.object({
  level: z.enum(['error', 'warn']),
  code: PreflightCode,
  message: z.string(),
  /** 0-based page index the item points at, for links into the editor. */
  pageIndex: z.number().int().nonnegative().optional(),
  slotId: z.string().optional(),
});
export type PreflightItem = z.infer<typeof PreflightItem>;

/** `ok` is false when any item is an error. */
export const Preflight = z.object({ ok: z.boolean(), items: z.array(PreflightItem) });
export type Preflight = z.infer<typeof Preflight>;

/* ---------- Public shares (M4) ---------- */

export const ShareStatus = z.enum(['active', 'expired', 'revoked']);
export type ShareStatus = z.infer<typeof ShareStatus>;

/** A share link as the admin UI sees it. The token appears only inside `url`. */
export const ShareView = z.object({
  id: z.string(),
  bookId: z.string(),
  url: z.url(),
  status: ShareStatus,
  hasPassword: z.boolean(),
  allowDownload: z.boolean(),
  expiresAt: z.iso.datetime().optional(),
  revokedAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  lastViewedAt: z.iso.datetime().optional(),
  views: z.number().int().nonnegative(),
  /** Set when the URL had to be built from the request origin because no public URL is configured. */
  warning: z.string().optional(),
});
export type ShareView = z.infer<typeof ShareView>;

export const CreateShareInput = z.object({
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  password: z.string().min(4).max(200).optional(),
  allowDownload: z.boolean().default(false),
});
export type CreateShareInput = z.infer<typeof CreateShareInput>;

export const UpdateShareInput = z.object({
  /** null removes the expiry. */
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
  /** null removes the password. */
  password: z.string().min(4).max(200).nullable().optional(),
  allowDownload: z.boolean().optional(),
});
export type UpdateShareInput = z.infer<typeof UpdateShareInput>;

export const UnlockShareInput = z.object({ password: z.string().min(1) });
export type UnlockShareInput = z.infer<typeof UnlockShareInput>;

/* ---------- Public viewer (M4) ---------- */

/** What `GET /s/:token/book.json` returns: no asset ids, no Immich data, only what the viewer draws. */
export const ViewerBook = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  /** "May 12 – 21, 2026" or absent. */
  dates: z.string().optional(),
  chapters: z.array(z.object({ title: z.string(), subtitle: z.string().optional(), startsAtPage: z.number().int().nonnegative() })),
  pageCount: z.number().int().nonnegative(),
  /** Whether `cover.png` exists for this share. */
  cover: z.boolean(),
  /** Where the front cover's trim box sits in `cover.png`, as fractions of the image, so the viewer can show it like a page. */
  coverFront: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  /** Whether `/pdf` is allowed (and a PDF exists). */
  download: z.boolean(),
  format: z.object({ trimWidthIn: z.number().positive(), trimHeightIn: z.number().positive(), bleedIn: z.number().nonnegative() }),
  /** Changes whenever the page PNGs change; the viewer appends it to image URLs as a cache buster. */
  version: z.string(),
});
export type ViewerBook = z.infer<typeof ViewerBook>;

/** 401 body on protected viewer routes. */
export const ViewerLocked = z.object({ needsPassword: z.literal(true), message: z.string().optional() });
/** 410 body for dead links. */
export const ViewerGone = z.object({ reason: z.enum(['expired', 'revoked']) });

import { z } from 'zod';
import { OrderStatus } from './book.js';

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

export const LuluEnv = z.enum(['sandbox', 'production']);
export type LuluEnv = z.infer<typeof LuluEnv>;

/** A Lulu client key/secret pair for one environment (Settings -> Lulu). */
export const LuluConnectionInput = z.object({
  env: LuluEnv,
  clientKey: z.string().trim().min(8),
  clientSecret: z.string().trim().min(8),
});
export type LuluConnectionInput = z.infer<typeof LuluConnectionInput>;

/**
 * Where the books ship to. Field names follow Lulu's `shipping_address` so the server passes it
 * through; `state_code` is required by Lulu for US, CA, AU, MX and a few others.
 */
export const ShippingAddress = z.object({
  name: z.string().trim().min(1).max(120),
  street1: z.string().trim().min(1).max(200),
  street2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  state_code: z.string().trim().max(3).optional(),
  postcode: z.string().trim().min(1).max(64),
  /** ISO 3166-1 alpha-2, upper case. */
  country_code: z
    .string()
    .trim()
    .length(2)
    .transform((s) => s.toUpperCase()),
  /** Lulu's carriers require one; pattern from the Lulu spec. */
  phone_number: z.string().trim().regex(/^\+?[\d\s\-.\/()]{8,20}$/, 'Enter a phone number with 8 to 20 digits'),
  email: z.email(),
});
export type ShippingAddress = z.infer<typeof ShippingAddress>;

export const SettingsView = z.object({
  immich: z.object({ url: z.string().optional(), apiKeySet: z.boolean() }),
  lulu: z.object({
    /** Which credential pair is active. */
    sandbox: z.boolean(),
    /** Whether the active pair is saved. */
    clientKeySet: z.boolean(),
    sandboxKeySet: z.boolean().default(false),
    productionKeySet: z.boolean().default(false),
    /** The address of the last order, pre-filled on the next one. */
    lastAddress: ShippingAddress.optional(),
  }),
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

/* ---------- Lulu ordering (M5) ---------- */

/** What `POST /api/lulu/test` reports: the token exchange and one authenticated call. */
export const LuluStatus = z.object({
  ok: z.boolean(),
  env: LuluEnv,
  baseUrl: z.string(),
  /** Print jobs on the account (from the one-item listing the test makes). */
  printJobs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type LuluStatus = z.infer<typeof LuluStatus>;

/** What `POST /api/lulu/reachability` reports after fetching a throwaway export through the public URL. */
export const ReachabilityReport = z.object({
  ok: z.boolean(),
  /** The URL that was fetched. */
  url: z.string(),
  status: z.number().int().optional(),
  latencyMs: z.number().nonnegative(),
  contentType: z.string().optional(),
  /** True when the body started with %PDF and matched the file's MD5. */
  isPdf: z.boolean(),
  error: z.string().optional(),
  /** What to fix, when known (Cloudflare Access login page, wrong PUBLIC_URL, ...). */
  hint: z.string().optional(),
});
export type ReachabilityReport = z.infer<typeof ReachabilityReport>;

export const ShippingLevel = z.enum(['MAIL', 'PRIORITY_MAIL', 'GROUND_HD', 'GROUND_BUS', 'GROUND', 'EXPEDITED', 'EXPRESS']);
export type ShippingLevel = z.infer<typeof ShippingLevel>;

export const SHIPPING_LEVEL_LABELS: Record<ShippingLevel, string> = {
  MAIL: 'Mail (slowest, may be untracked)',
  PRIORITY_MAIL: 'Priority mail',
  GROUND_HD: 'Ground, home delivery',
  GROUND_BUS: 'Ground, business address',
  GROUND: 'Ground',
  EXPEDITED: 'Expedited (2nd day)',
  EXPRESS: 'Express (overnight)',
};

/** One carrier option from Lulu's `/shipping-options/`, with the cost when Lulu priced it. */
export const ShippingOption = z.object({
  level: ShippingLevel,
  /** Decimal string in `currency`; absent when Lulu did not price the option. */
  cost: z.string().optional(),
  currency: z.string().optional(),
  traceable: z.boolean().default(false),
  minDeliveryDate: z.string().optional(),
  maxDeliveryDate: z.string().optional(),
  totalDaysMin: z.number().int().optional(),
  totalDaysMax: z.number().int().optional(),
});
export type ShippingOption = z.infer<typeof ShippingOption>;

/** Lulu's `/print-job-cost-calculations/` boiled down to what the cost table shows (decimal strings). */
export const OrderCost = z.object({
  currency: z.string(),
  lineItems: z.array(
    z.object({
      quantity: z.number().int().positive(),
      unitCost: z.string(),
      totalExclTax: z.string(),
      totalInclTax: z.string(),
      tax: z.string(),
      discounts: z.array(z.object({ amount: z.string(), description: z.string() })).default([]),
    }),
  ),
  shipping: z.object({ exclTax: z.string(), inclTax: z.string(), tax: z.string() }),
  fulfillment: z.object({ exclTax: z.string(), inclTax: z.string(), tax: z.string() }).optional(),
  fees: z.array(z.object({ type: z.string(), exclTax: z.string(), inclTax: z.string() })).default([]),
  totalExclTax: z.string(),
  totalTax: z.string(),
  totalInclTax: z.string(),
  totalDiscount: z.string().optional(),
});
export type OrderCost = z.infer<typeof OrderCost>;

/** Lulu's raw print-job status names. */
export const LuluJobStatus = z.enum([
  'CREATED',
  'REJECTED',
  'UNPAID',
  'PAYMENT_IN_PROGRESS',
  'PRODUCTION_READY',
  'PRODUCTION_DELAYED',
  'IN_PRODUCTION',
  'ERROR',
  'SHIPPED',
  'CANCELED',
]);
export type LuluJobStatus = z.infer<typeof LuluJobStatus>;

/** Something Lulu or the app said about the order, oldest first. */
export const OrderMessage = z.object({
  at: z.iso.datetime(),
  level: z.enum(['info', 'warn', 'error']),
  /** Where it came from: the app's own steps, or a Lulu endpoint. */
  source: z.enum(['app', 'lulu']),
  text: z.string(),
});
export type OrderMessage = z.infer<typeof OrderMessage>;

export const OrderTracking = z.object({ carrier: z.string().optional(), url: z.url() });
export type OrderTracking = z.infer<typeof OrderTracking>;

/** Result of one of Lulu's file validations (`/validate-interior/`, `/validate-cover/`). */
export const FileValidation = z.object({
  id: z.number().int().optional(),
  status: z.enum(['pending', 'ok', 'error']),
  errors: z.array(z.string()).default([]),
  /** Page count Lulu detected in the interior file. */
  pageCount: z.number().int().optional(),
});
export type FileValidation = z.infer<typeof FileValidation>;

/** An order as the UI sees it (table `orders`). */
export const OrderView = z.object({
  id: z.string(),
  bookId: z.string(),
  env: LuluEnv,
  status: OrderStatus,
  luluStatus: LuluJobStatus.optional(),
  luluJobId: z.string().optional(),
  externalId: z.string(),
  podPackageId: z.string(),
  pageCount: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  shippingLevel: ShippingLevel,
  shippingAddress: ShippingAddress,
  contactEmail: z.email(),
  cost: OrderCost.optional(),
  shippingOptions: z.array(ShippingOption).default([]),
  validation: z.object({ interior: FileValidation.optional(), cover: FileValidation.optional() }).default({}),
  messages: z.array(OrderMessage).default([]),
  tracking: z.array(OrderTracking).default([]),
  /** Where to pay: the job on lulu.com (or the sandbox site). */
  payUrl: z.string().optional(),
  /** The public export URLs Lulu downloads; present once exports exist. */
  exports: z.object({ interior: z.string(), cover: z.string(), expiresAt: z.iso.datetime() }).optional(),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OrderView = z.infer<typeof OrderView>;

/** `POST /api/books/:id/orders`: validate the files, quote the price. */
export const PrepareOrderInput = z.object({
  quantity: z.number().int().min(1).max(100).default(1),
  shippingLevel: ShippingLevel.default('MAIL'),
  shippingAddress: ShippingAddress,
  /** Lulu's contact for the job; defaults to the address email. */
  contactEmail: z.email().optional(),
});
export type PrepareOrderInput = z.infer<typeof PrepareOrderInput>;

/** Order statuses that still change on their own (the ticker refreshes these). */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ['submitted', 'unpaid', 'in-production'];

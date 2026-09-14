import {
  ACTIVE_ORDER_STATUSES,
  FORMAT_PRESETS,
  FileValidation,
  LuluJobStatus,
  luluPodPackageId,
  OrderCost,
  OrderMessage,
  OrderTracking,
  ShippingAddress,
  ShippingOption,
  type Book,
  type LuluEnv,
  type OrderStatus,
  type OrderView,
  type PrepareOrderInput,
  type RenderJob,
  type ShippingLevel,
} from '@bookbinder/shared';
import { preflightBook } from '@bookbinder/layout';
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BookStore } from '../books/store.js';
import type { Db } from '../db/index.js';
import { orders, type OrderRow } from '../db/schema.js';
import type { RenderService } from '../render/service.js';
import type { SettingsStore } from '../settings.js';
import { LuluApiError, type LuluClient, type LuluCostCalculation, type LuluFileValidation, type LuluPrintJob, type LuluPrintJobStatus } from './client.js';
import { exportPath, type ExportStore } from './exports.js';
import { describeLuluError } from './status.js';

/**
 * Where an UNPAID job is paid. Lulu's spec says jobs are "paid for through the developer portal";
 * the portal lists print jobs at /print-jobs (the job id is shown there). The per-job path could not
 * be verified offline, so the list page is linked (M5 judgement call).
 */
export const LULU_PAY_URLS: Record<LuluEnv, string> = {
  sandbox: 'https://developers.sandbox.lulu.com/print-jobs',
  production: 'https://developers.lulu.com/print-jobs',
};

/** Lulu's raw status -> the app's order status. */
export function mapLuluStatus(name: string): OrderStatus | undefined {
  switch (name) {
    case 'CREATED':
      return 'submitted';
    case 'UNPAID':
    case 'PAYMENT_IN_PROGRESS':
      return 'unpaid';
    case 'PRODUCTION_DELAYED':
    case 'PRODUCTION_READY':
    case 'IN_PRODUCTION':
      return 'in-production';
    case 'SHIPPED':
      return 'shipped';
    case 'REJECTED':
      return 'rejected';
    case 'ERROR':
      return 'error';
    case 'CANCELED':
      return 'canceled';
    default:
      return undefined;
  }
}

/** Thrown for user-facing refusals; the route maps `status` to the HTTP code. */
export class OrderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export interface OrderServiceDeps {
  db: Db;
  books: BookStore;
  renders: RenderService;
  exports: ExportStore;
  settings: SettingsStore;
  /** Client for the active environment, or undefined until credentials are saved. */
  client: () => LuluClient | undefined;
  /** Configured public base without a trailing slash, or undefined. */
  publicBase: () => string | undefined;
  log: FastifyBaseLogger;
  /** Validation polling (Lulu takes tens of seconds; tests use milliseconds). */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Background refresh of active orders; 0 disables the ticker (tests). */
  tickerMs?: number;
}

const Validation = z.object({ interior: FileValidation.optional(), cover: FileValidation.optional() });
type ValidationState = z.infer<typeof Validation>;

function parseJson<T>(schema: z.ZodType<T>, json: string | null, fallback: T): T {
  if (json === null) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** Lulu's cost calculation boiled down to the shared `OrderCost`. */
export function toOrderCost(c: LuluCostCalculation): OrderCost {
  const block = (b: { total_cost_excl_tax?: string | undefined; total_cost_incl_tax?: string | undefined; total_tax?: string | undefined } | null | undefined) =>
    b ? { exclTax: b.total_cost_excl_tax ?? '0.00', inclTax: b.total_cost_incl_tax ?? b.total_cost_excl_tax ?? '0.00', tax: b.total_tax ?? '0.00' } : undefined;
  const shipping = block(c.shipping_cost) ?? { exclTax: '0.00', inclTax: '0.00', tax: '0.00' };
  const fulfillment = block(c.fulfillment_cost);
  return {
    currency: c.currency,
    lineItems: c.line_item_costs.map((li) => ({
      quantity: Math.round(li.quantity),
      unitCost: li.unit_tier_cost ?? li.cost_excl_discounts ?? (Number(li.total_cost_excl_tax) / Math.max(1, li.quantity)).toFixed(2),
      totalExclTax: li.total_cost_excl_tax,
      totalInclTax: li.total_cost_incl_tax,
      tax: li.total_tax ?? '0.00',
      discounts: (li.discounts ?? []).map((d) => ({ amount: d.amount, description: d.description })),
    })),
    shipping,
    ...(fulfillment ? { fulfillment } : {}),
    fees: (c.fees ?? []).map((f) => ({ type: f.fee_type ?? 'fee', exclTax: f.total_cost_excl_tax ?? '0.00', inclTax: f.total_cost_incl_tax ?? f.total_cost_excl_tax ?? '0.00' })),
    totalExclTax: c.total_cost_excl_tax,
    totalTax: c.total_tax ?? '0.00',
    totalInclTax: c.total_cost_incl_tax,
    ...(c.total_discount_amount ? { totalDiscount: c.total_discount_amount } : {}),
  };
}

function toFileValidation(v: LuluFileValidation): FileValidation {
  const s = v.status.toUpperCase();
  const status: FileValidation['status'] = s === 'ERROR' ? 'error' : s === 'VALIDATED' || s === 'NORMALIZED' ? 'ok' : 'pending';
  const pages = v.page_count === null || v.page_count === undefined ? undefined : Number(v.page_count);
  return { id: v.id, status, errors: v.errors ?? [], ...(pages !== undefined && Number.isFinite(pages) ? { pageCount: pages } : {}) };
}

/** Tracking links from a status answer (`line_item_statuses[].messages`) or a job's line items. */
export function trackingFrom(status: LuluPrintJobStatus | undefined, job?: Pick<LuluPrintJob, 'line_items'>): OrderTracking[] {
  const out: OrderTracking[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined | null, carrier: string | undefined | null) => {
    if (!url || seen.has(url) || !/^https?:\/\//.test(url)) return;
    seen.add(url);
    out.push({ url, ...(carrier ? { carrier } : {}) });
  };
  for (const li of status?.line_item_statuses ?? []) {
    for (const u of li.messages?.tracking_urls ?? []) add(u, li.messages?.carrier_name);
    const single = li.messages?.url;
    for (const u of Array.isArray(single) ? single : single ? [single] : []) add(u, li.messages?.carrier_name);
  }
  for (const li of job?.line_items ?? []) {
    for (const u of li.tracking_urls ?? []) add(u, li.status?.messages?.carrier_name);
    for (const u of li.status?.messages?.tracking_urls ?? []) add(u, li.status?.messages?.carrier_name);
  }
  return out;
}

/**
 * Owns the `orders` table and the Lulu order flow: prepare (exports, validations, quote), submit
 * (print job), refresh (status + tracking), cancel. Preparation runs in the background after the
 * row is created; the UI polls the order. A ticker refreshes active orders every `tickerMs`.
 */
export class OrderService {
  private pending: Promise<void> = Promise.resolve();
  private ticker: NodeJS.Timeout | undefined;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(private readonly deps: OrderServiceDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 3000;
    this.pollTimeoutMs = deps.pollTimeoutMs ?? 5 * 60_000;
    // A restart mid-validation leaves rows in `validating`; they can never finish, so say so.
    const stale = deps.db.select().from(orders).where(inArray(orders.status, ['draft', 'validating'])).all();
    for (const row of stale) {
      this.update(row.id, { status: 'error', error: 'Interrupted by a server restart; validate and quote again' }, this.message(row, 'error', 'app', 'Interrupted by a server restart.'));
    }
    const tickerMs = deps.tickerMs ?? 10 * 60_000;
    if (tickerMs > 0) {
      this.ticker = setInterval(() => void this.refreshActive(), tickerMs);
      this.ticker.unref();
    }
  }

  close(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  /** Resolves when background preparation has finished (tests). */
  idle(): Promise<void> {
    return this.pending;
  }

  list(bookId: string): OrderView[] {
    return this.deps.db.select().from(orders).where(eq(orders.bookId, bookId)).orderBy(desc(orders.createdAt)).all().map((r) => this.view(r));
  }

  /** Every order of every book, newest first (the Orders page). */
  listAll(): OrderView[] {
    return this.deps.db.select().from(orders).orderBy(desc(orders.createdAt)).all().map((r) => this.view(r));
  }

  get(id: string): OrderView | undefined {
    const row = this.row(id);
    return row ? this.view(row) : undefined;
  }

  private row(id: string): OrderRow | undefined {
    return this.deps.db.select().from(orders).where(eq(orders.id, id)).get();
  }

  view(row: OrderRow): OrderView {
    const interior = row.interiorExportId ? this.deps.exports.get(row.interiorExportId) : undefined;
    const cover = row.coverExportId ? this.deps.exports.get(row.coverExportId) : undefined;
    const base = this.deps.publicBase();
    const luluStatus = LuluJobStatus.safeParse(row.luluStatus);
    return {
      id: row.id,
      bookId: row.bookId,
      env: row.env as LuluEnv,
      status: row.status as OrderStatus,
      ...(luluStatus.success ? { luluStatus: luluStatus.data } : {}),
      ...(row.luluJobId ? { luluJobId: row.luluJobId, payUrl: LULU_PAY_URLS[row.env as LuluEnv] } : {}),
      externalId: row.externalId,
      podPackageId: row.podPackageId,
      pageCount: row.pageCount,
      quantity: row.quantity,
      shippingLevel: row.shippingLevel as ShippingLevel,
      shippingAddress: parseJson(ShippingAddress, row.shippingAddress, {} as ShippingAddress),
      contactEmail: row.contactEmail,
      ...(row.cost ? { cost: parseJson(OrderCost, row.cost, undefined as unknown as OrderCost) } : {}),
      shippingOptions: parseJson(z.array(ShippingOption), row.shippingOptions, []),
      validation: parseJson(Validation, row.validation, {}),
      messages: parseJson(z.array(OrderMessage), row.messages, []),
      tracking: parseJson(z.array(OrderTracking), row.tracking, []),
      ...(interior && cover && base ? { exports: { interior: `${base}${exportPath(interior.token)}`, cover: `${base}${exportPath(cover.token)}`, expiresAt: interior.expiresAt } } : {}),
      ...(row.error ? { error: row.error } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private update(id: string, patch: Partial<typeof orders.$inferInsert>, messages?: OrderMessage[]): void {
    this.deps.db
      .update(orders)
      .set({ ...patch, ...(messages ? { messages: JSON.stringify(messages) } : {}), updatedAt: new Date().toISOString() })
      .where(eq(orders.id, id))
      .run();
  }

  /** The row's messages plus one more (returned, not saved). */
  private message(row: OrderRow, level: OrderMessage['level'], source: OrderMessage['source'], text: string): OrderMessage[] {
    const list = parseJson(z.array(OrderMessage), row.messages, []);
    return [...list, { at: new Date().toISOString(), level, source, text }].slice(-50);
  }

  private say(id: string, level: OrderMessage['level'], source: OrderMessage['source'], text: string, patch: Partial<typeof orders.$inferInsert> = {}): void {
    const row = this.row(id);
    if (!row) return;
    this.update(id, patch, this.message(row, level, source, text));
  }

  private requireClient(): LuluClient {
    const client = this.deps.client();
    if (!client) throw new OrderError(409, 'Lulu is not configured. Save a client key and secret in Settings first.');
    return client;
  }

  /**
   * Creates an order in `validating` and, in the background, publishes the print and cover PDFs,
   * runs Lulu's validations, asks for shipping options and a cost calculation -> `quoted`.
   * Refuses (409) when preflight has errors or a current print/cover render is missing.
   */
  async prepare(book: Book, input: PrepareOrderInput): Promise<OrderView> {
    this.requireClient();
    const base = this.deps.publicBase();
    if (!base) throw new OrderError(409, 'No public URL is configured. Lulu downloads the PDFs from it; set PUBLIC_URL (or the public URL in Settings).');
    // Lulu fetches over HTTPS; plain http is only useful against the fake on this machine.
    if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:|\/|$)/.test(base)) {
      throw new OrderError(409, `The public URL must use HTTPS for Lulu to download the PDFs (it is ${base}).`);
    }
    const format = FORMAT_PRESETS[book.formatId];
    if (!format) throw new OrderError(400, `Unknown format ${book.formatId}`);
    if (format.vendor !== 'lulu' || !format.luluTrim) throw new OrderError(409, `${format.name} is a home-print format; Lulu cannot print it.`);
    const renders = this.deps.renders.list(book.id);
    const preflight = preflightBook({ book, format, assets: this.deps.books.assetMap(book.id), renders });
    const errors = preflight.items.filter((i) => i.level === 'error');
    if (errors.length > 0) {
      const shown = errors.slice(0, 3).map((e) => e.message);
      const more = errors.length > 3 ? ` (and ${errors.length - 3} more)` : '';
      throw new OrderError(409, `Preflight has ${errors.length} error${errors.length === 1 ? '' : 's'}: ${shown.join(' ')}${more}`);
    }
    const current = (kind: 'print' | 'cover'): RenderJob | undefined =>
      renders.find((r) => r.kind === kind && r.status === 'done' && r.finishedAt !== undefined && r.finishedAt >= book.updatedAt);
    const print = current('print');
    const cover = current('cover');
    if (!print) throw new OrderError(409, 'Render the print PDF first (it must be newer than the last change to the book).');
    if (!cover) throw new OrderError(409, 'Render the cover PDF first (it must be newer than the last change to the book).');
    if (cover.data?.cover && cover.data.cover.pageCount !== book.pages.length) throw new OrderError(409, 'The cover PDF was sized for a different page count; render it again.');
    const printFile = this.deps.renders.filePath(print.id);
    const coverFile = this.deps.renders.filePath(cover.id);
    if (!printFile || !coverFile) throw new OrderError(409, 'A render file is missing on disk; render again.');

    const id = randomUUID();
    const now = new Date().toISOString();
    const env = this.deps.settings.luluEnv();
    const podPackageId = luluPodPackageId(format, book.luluProduct);
    const contactEmail = input.contactEmail ?? input.shippingAddress.email;
    this.deps.db
      .insert(orders)
      .values({
        id,
        bookId: book.id,
        env,
        status: 'draft',
        podPackageId,
        pageCount: book.pages.length,
        quantity: input.quantity,
        shippingLevel: input.shippingLevel,
        shippingAddress: JSON.stringify(input.shippingAddress),
        contactEmail,
        externalId: `${book.id}:${id}`,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    this.deps.settings.setLastAddress(input.shippingAddress);
    const [interior, coverExport] = await Promise.all([
      this.deps.exports.create({ bookId: book.id, renderId: print.id, filePath: printFile }),
      this.deps.exports.create({ bookId: book.id, renderId: cover.id, filePath: coverFile }),
    ]);
    this.say(id, 'info', 'app', `Published the print PDF (${print.pageCount ?? book.pages.length} pages) and the cover PDF for Lulu to download.`, {
      status: 'validating',
      interiorExportId: interior.id,
      coverExportId: coverExport.id,
    });
    this.pending = this.pending.then(() => this.validateAndQuote(id, base, book)).catch((err) => this.deps.log.error({ err, orderId: id }, 'order preparation failed'));
    return this.get(id)!;
  }

  private async validateAndQuote(id: string, base: string, book: Book): Promise<void> {
    const log = this.deps.log.child({ orderId: id, bookId: book.id });
    try {
      const client = this.requireClient();
      const row = this.row(id);
      if (!row || row.status !== 'validating') return;
      const interior = this.deps.exports.get(row.interiorExportId!)!;
      const cover = this.deps.exports.get(row.coverExportId!)!;
      const interiorUrl = `${base}${exportPath(interior.token)}`;
      const coverUrl = `${base}${exportPath(cover.token)}`;
      const address = parseJson(ShippingAddress, row.shippingAddress, undefined as unknown as ShippingAddress);

      const state: ValidationState = {};
      const started = await Promise.all([
        client.validateInterior({ sourceUrl: interiorUrl, podPackageId: row.podPackageId }),
        client.validateCover({ sourceUrl: coverUrl, podPackageId: row.podPackageId, pageCount: row.pageCount }),
      ]);
      state.interior = toFileValidation(started[0]!);
      state.cover = toFileValidation(started[1]!);
      this.update(id, { validation: JSON.stringify(state) });
      log.info({ interior: started[0]!.id, cover: started[1]!.id }, 'lulu validations started');

      const deadline = Date.now() + this.pollTimeoutMs;
      while ((state.interior.status === 'pending' || state.cover.status === 'pending') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        if (state.interior.status === 'pending') state.interior = toFileValidation(await client.getInteriorValidation(started[0]!.id));
        if (state.cover.status === 'pending') state.cover = toFileValidation(await client.getCoverValidation(started[1]!.id));
        this.update(id, { validation: JSON.stringify(state) });
      }
      if (state.interior.status === 'pending' || state.cover.status === 'pending') {
        this.say(id, 'error', 'app', `Lulu did not finish validating within ${Math.round(this.pollTimeoutMs / 60_000)} minutes.`, { status: 'error', error: 'Validation timed out' });
        return;
      }
      const problems = [...state.interior.errors.map((e) => `Interior: ${e}`), ...state.cover.errors.map((e) => `Cover: ${e}`)];
      if (state.interior.status === 'error' || state.cover.status === 'error') {
        const text = problems.length > 0 ? problems.join(' ') : 'Lulu rejected a file without saying why.';
        this.say(id, 'error', 'lulu', text, { status: 'rejected', error: text });
        log.warn({ problems }, 'lulu rejected the files');
        return;
      }
      if (state.interior.pageCount !== undefined && state.interior.pageCount !== row.pageCount) {
        const text = `Lulu counted ${state.interior.pageCount} interior pages, the book has ${row.pageCount}. Render the print PDF again.`;
        this.say(id, 'error', 'lulu', text, { status: 'rejected', error: text });
        return;
      }
      this.say(id, 'info', 'lulu', 'Interior and cover files validated.');

      const [options, cost] = await Promise.all([
        client.shippingOptions({ podPackageId: row.podPackageId, pageCount: row.pageCount, quantity: row.quantity, address }),
        client.costCalculation({ podPackageId: row.podPackageId, pageCount: row.pageCount, quantity: row.quantity, address, shippingLevel: row.shippingLevel as ShippingLevel }),
      ]);
      const shippingOptions: ShippingOption[] = options.map((o) => ({
        level: o.level as ShippingLevel,
        ...(o.cost_excl_tax ? { cost: o.cost_excl_tax } : {}),
        ...(o.currency ? { currency: o.currency } : {}),
        traceable: o.traceable ?? false,
        ...(o.min_delivery_date ? { minDeliveryDate: o.min_delivery_date } : {}),
        ...(o.max_delivery_date ? { maxDeliveryDate: o.max_delivery_date } : {}),
        ...(o.total_days_min !== null && o.total_days_min !== undefined ? { totalDaysMin: Math.round(o.total_days_min) } : {}),
        ...(o.total_days_max !== null && o.total_days_max !== undefined ? { totalDaysMax: Math.round(o.total_days_max) } : {}),
      })).filter((o) => ShippingOption.safeParse(o).success);
      const orderCost = toOrderCost(cost);
      this.say(id, 'info', 'lulu', `Quoted ${orderCost.totalInclTax} ${orderCost.currency} for ${row.quantity} ${row.quantity === 1 ? 'copy' : 'copies'} (${row.shippingLevel} shipping).`, {
        status: 'quoted',
        cost: JSON.stringify(orderCost),
        shippingOptions: JSON.stringify(shippingOptions),
        error: null,
      });
      log.info({ total: orderCost.totalInclTax, currency: orderCost.currency }, 'order quoted');
    } catch (err) {
      const text = describeLuluError(err);
      log.error({ err }, 'order preparation failed');
      this.say(id, 'error', err instanceof LuluApiError ? 'lulu' : 'app', text, { status: 'error', error: text });
    }
  }

  /** Creates the Lulu print job for a quoted order and marks the book `ordered`. */
  async submit(id: string): Promise<OrderView> {
    const row = this.row(id);
    if (!row) throw new OrderError(404, 'Order not found');
    if (row.status !== 'quoted') throw new OrderError(409, `Only a quoted order can be placed (this one is ${row.status}).`);
    const client = this.requireClient();
    if (this.deps.settings.luluEnv() !== row.env) throw new OrderError(409, `This order was quoted in the ${row.env} environment; switch Settings back to ${row.env} to place it.`);
    const base = this.deps.publicBase();
    const interior = row.interiorExportId ? this.deps.exports.get(row.interiorExportId) : undefined;
    const cover = row.coverExportId ? this.deps.exports.get(row.coverExportId) : undefined;
    if (!base || !interior || !cover) throw new OrderError(409, 'The export URLs are gone; validate and quote again.');
    if (this.deps.exports.isExpired(interior) || this.deps.exports.isExpired(cover)) throw new OrderError(409, 'The export URLs have expired; validate and quote again.');
    const book = this.deps.books.get(row.bookId);
    if (!book) throw new OrderError(404, 'Book not found');
    const address = parseJson(ShippingAddress, row.shippingAddress, undefined as unknown as ShippingAddress);
    try {
      const job = await client.createPrintJob({
        contactEmail: row.contactEmail,
        externalId: row.externalId,
        shippingLevel: row.shippingLevel as ShippingLevel,
        shippingAddress: address,
        lineItems: [
          {
            title: book.title,
            quantity: row.quantity,
            podPackageId: row.podPackageId,
            interior: { sourceUrl: `${base}${exportPath(interior.token)}`, md5: interior.md5 },
            cover: { sourceUrl: `${base}${exportPath(cover.token)}`, md5: cover.md5 },
            externalId: `${row.externalId}:1`,
          },
        ],
      });
      const luluStatus = job.status?.name ?? 'CREATED';
      const status = mapLuluStatus(luluStatus) ?? 'submitted';
      this.say(id, 'info', 'lulu', `Print job ${job.id} created (${luluStatus}).${status === 'unpaid' || status === 'submitted' ? ' Pay it on lulu.com to start production.' : ''}`, {
        luluJobId: String(job.id),
        luluStatus,
        status,
        error: null,
        tracking: JSON.stringify(trackingFrom(undefined, job)),
      });
      if (job.status?.message && status === 'rejected') this.say(id, 'error', 'lulu', job.status.message, { error: job.status.message });
      this.deps.books.setStatus(book.id, 'ordered');
      this.deps.log.info({ orderId: id, bookId: book.id, luluJobId: job.id, env: row.env }, 'print job created');
    } catch (err) {
      if (err instanceof OrderError) throw err;
      const text = describeLuluError(err);
      this.say(id, 'error', err instanceof LuluApiError ? 'lulu' : 'app', text, { status: 'error', error: text });
      throw new OrderError(502, `Lulu did not accept the print job: ${text}`);
    }
    return this.refresh(id);
  }

  /** Polls Lulu for the job's status and tracking; a no-op for orders without a job. */
  async refresh(id: string): Promise<OrderView> {
    const row = this.row(id);
    if (!row) throw new OrderError(404, 'Order not found');
    if (!row.luluJobId) return this.view(row);
    const client = this.requireClient();
    try {
      const status = await client.getPrintJobStatus(row.luluJobId);
      let tracking = trackingFrom(status);
      if (status.name === 'SHIPPED' && tracking.length === 0) {
        const job = await client.getPrintJob(row.luluJobId).catch(() => undefined);
        if (job) tracking = trackingFrom(undefined, job);
      }
      const mapped = mapLuluStatus(status.name);
      const patch: Partial<typeof orders.$inferInsert> = { luluStatus: status.name, ...(mapped ? { status: mapped } : {}) };
      if (tracking.length > 0) patch.tracking = JSON.stringify(tracking);
      if (mapped === 'rejected' || mapped === 'error') patch.error = status.message ?? `Lulu reports ${status.name}`;
      else if (mapped) patch.error = null;
      if (status.name !== row.luluStatus) {
        const level = mapped === 'rejected' || mapped === 'error' ? 'error' : 'info';
        this.say(id, level, 'lulu', `${status.name}${status.message ? `: ${status.message}` : ''}`, patch);
      } else this.update(id, patch);
    } catch (err) {
      const text = describeLuluError(err);
      this.say(id, 'warn', err instanceof LuluApiError ? 'lulu' : 'app', `Status check failed: ${text}`);
      if (err instanceof LuluApiError && err.status === 404) this.update(id, { status: 'error', error: 'Lulu no longer knows this print job' });
    }
    return this.get(id)!;
  }

  /**
   * Cancels: locally for orders that never reached Lulu; through Lulu's status resource while
   * UNPAID (if Lulu refuses, the order is marked canceled here and the user told to cancel on lulu.com).
   */
  async cancel(id: string): Promise<OrderView> {
    const row = this.row(id);
    if (!row) throw new OrderError(404, 'Order not found');
    const status = row.status as OrderStatus;
    if (status === 'shipped' || status === 'canceled' || status === 'in-production') throw new OrderError(409, `An order that is ${status} cannot be canceled from here.`);
    if (!row.luluJobId) {
      this.say(id, 'info', 'app', 'Canceled before a print job was created.', { status: 'canceled', error: null });
      return this.get(id)!;
    }
    if (status !== 'unpaid' && status !== 'submitted') throw new OrderError(409, `Only an unpaid print job can be canceled (this one is ${status}).`);
    const client = this.requireClient();
    try {
      const res = await client.cancelPrintJob(row.luluJobId);
      this.say(id, 'info', 'lulu', `Print job ${row.luluJobId} canceled${res.message ? `: ${res.message}` : ''}.`, { status: 'canceled', luluStatus: res.name, error: null });
    } catch (err) {
      const text = describeLuluError(err);
      this.say(id, 'warn', 'lulu', `Lulu refused the cancellation (${text}). The order is marked canceled here; cancel print job ${row.luluJobId} on lulu.com as well.`, {
        status: 'canceled',
      });
    }
    return this.get(id)!;
  }

  /** Refreshes every order that still moves on its own (the ticker, and Settings' manual refresh). */
  async refreshActive(): Promise<number> {
    if (!this.deps.client()) return 0;
    const rows = this.deps.db.select().from(orders).where(inArray(orders.status, [...ACTIVE_ORDER_STATUSES])).all();
    let n = 0;
    for (const row of rows) {
      if (!row.luluJobId) continue;
      await this.refresh(row.id).catch((err) => this.deps.log.warn({ err, orderId: row.id }, 'background refresh failed'));
      n += 1;
    }
    return n;
  }
}

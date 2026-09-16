/**
 * A stand-in for the Lulu Print API (specs/lulu-openapi.yml) covering every endpoint the app calls:
 * OAuth token, cover dimensions, interior/cover validation, shipping options, cost calculation,
 * print jobs (create, read, list, status, cancel). Used by the server tests and runnable on its
 * own for local development:
 *
 *   corepack pnpm --filter @bookbinder/server exec tsx src/test/fake-lulu.ts --port 2390
 *
 * Then start the server with LULU_BASE_URL=http://127.0.0.1:2390 and enter `fake-key` /
 * `fake-secret` in Settings -> Lulu (any environment).
 *
 * Realism that matters to the app: validations really download the source URL (so the public
 * export URLs are exercised), the MD5 in a print job is checked against the downloaded file, a
 * job's status advances one step on every status poll (CREATED -> UNPAID -> ... -> SHIPPED with a
 * tracking URL; the first poll after creation already answers UNPAID), and cancelling is refused once
 * a job left UNPAID.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

export interface FakeLuluOptions {
  port?: number;
  host?: string;
  clientKey?: string;
  clientSecret?: string;
  logger?: boolean;
  /** Seconds a token lives (default 3600). */
  tokenTtlSeconds?: number;
}

export interface FakeLuluJob {
  id: number;
  status: string;
  message: string;
  externalId?: string;
  body: Record<string, unknown>;
  trackingUrl?: string;
  createdAt: string;
  /** Interior page count per line item, from the downloaded PDFs (Lulu reports it read-only on the line item). */
  pageCounts?: number[];
}

export interface FakeLuluBehaviour {
  /** When set, the next interior validation ends in ERROR with these messages. */
  interiorErrors?: string[] | undefined;
  coverErrors?: string[] | undefined;
  /** Advance a job's status on every status poll (default true). */
  advanceOnPoll: boolean;
}

export interface FakeLulu {
  url: string;
  app: FastifyInstance;
  clientKey: string;
  clientSecret: string;
  jobs: Map<number, FakeLuluJob>;
  /** Files the fake downloaded, by URL: md5 and byte size. */
  downloads: Map<string, { md5: string; bytes: number; pages: number }>;
  behaviour: FakeLuluBehaviour;
  requests: { method: string; path: string }[];
  /** Webhook subscriptions (M7) and what was delivered to them. */
  webhooks: Map<string, { id: string; url: string; topics: string[]; is_active: boolean }>;
  deliveries: Array<{ url: string; status: number | undefined; topic: string; jobId: number }>;
  /** Resolves once every webhook delivery so far has been answered. */
  webhooksIdle(): Promise<void>;
  /** Sends a PRINT_JOB_STATUS_CHANGED submission for a job as it currently is. */
  fire(jobId: number): void;
  /** Forget every issued token (the next authenticated call gets a 401). */
  revokeTokens(): void;
  close(): Promise<void>;
}

const STATUS_FLOW = ['CREATED', 'UNPAID', 'PAYMENT_IN_PROGRESS', 'PRODUCTION_READY', 'IN_PRODUCTION', 'SHIPPED'];
const STATUS_MESSAGES: Record<string, string> = {
  CREATED: 'Print-job is currently being validated',
  UNPAID: 'Print-job can be paid',
  PAYMENT_IN_PROGRESS: 'Payment is in progress',
  PRODUCTION_READY: 'Print-job will move to production shortly',
  IN_PRODUCTION: 'Print-job submitted to printer',
  SHIPPED: 'All line-items were shipped',
  CANCELED: 'Print-job was canceled',
  REJECTED: 'Print-job was rejected',
};

const SHIPPING: Array<{ level: string; cost: number; days: [number, number]; usOnly?: boolean }> = [
  { level: 'MAIL', cost: 3.99, days: [6, 12] },
  { level: 'PRIORITY_MAIL', cost: 7.99, days: [4, 8] },
  { level: 'GROUND', cost: 5.99, days: [4, 7], usOnly: true },
  { level: 'EXPEDITED', cost: 14.99, days: [2, 4] },
  { level: 'EXPRESS', cost: 29.99, days: [1, 2] },
];

/** Trim size in inches from the dotted pod_package_id (`0850X0850.FC.PRE.CW.080CW444.MXX`). */
export function parsePodPackageId(id: string): { trimW: number; trimH: number; quality: string; binding: string; paper: string } | undefined {
  const m = /^(\d{4})X(\d{4})\.(FC|BW)\.(PRE|STD)\.(CW|LW|PB|CO|SS)\.(\w{8})\.(\w{3})$/.exec(id);
  if (!m) return undefined;
  return { trimW: Number(m[1]) / 100, trimH: Number(m[2]) / 100, quality: m[4]!, binding: m[5]!, paper: m[6]! };
}

/**
 * The fake's own cover math (on purpose NOT the app's estimate, so a test can tell which one sized
 * the sheet): hardcovers wrap 0.6875 in and add a 0.2 in board allowance to the spine.
 */
export function fakeCoverDimensionsIn(podPackageId: string, pageCount: number): { width: number; height: number } | undefined {
  const p = parsePodPackageId(podPackageId);
  if (!p) return undefined;
  const hard = p.binding === 'CW' || p.binding === 'LW';
  const caliper = p.paper.startsWith('080') ? 0.0023 : 0.0026;
  const spine = pageCount * caliper + (hard ? 0.2 : 0);
  const wrap = hard ? 0.6875 : 0.125;
  return { width: 2 * wrap + 2 * p.trimW + spine, height: 2 * wrap + p.trimH };
}

function money(n: number): string {
  return n.toFixed(2);
}

/** Unit price the fake charges: roughly Lulu's list price shape (base + per page), hardcover extra. */
export function fakeUnitPrice(podPackageId: string, pageCount: number): number {
  const p = parsePodPackageId(podPackageId);
  if (!p) return 0;
  const perPage = p.quality === 'PRE' ? 0.21 : 0.04;
  const base = p.quality === 'PRE' ? 3.5 : 2.0;
  const binding = p.binding === 'CW' ? 7.5 : p.binding === 'LW' ? 12 : 0;
  return base + binding + perPage * pageCount;
}

export async function startFakeLulu(opts: FakeLuluOptions = {}): Promise<FakeLulu> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const clientKey = opts.clientKey ?? 'fake-key';
  const clientSecret = opts.clientSecret ?? 'fake-secret';
  const tokens = new Map<string, number>();
  const jobs = new Map<number, FakeLuluJob>();
  const downloads = new Map<string, { md5: string; bytes: number; pages: number }>();
  const validations = new Map<number, { kind: 'interior' | 'cover'; url: string; polls: number; errors: string[] | undefined; pages: number | undefined; ok: boolean }>();
  const requests: { method: string; path: string }[] = [];
  const behaviour: FakeLuluBehaviour = { advanceOnPoll: true };
  const webhooks = new Map<string, { id: string; url: string; topics: string[]; is_active: boolean }>();
  const deliveries: Array<{ url: string; status: number | undefined; topic: string; jobId: number }> = [];
  let inflight: Promise<unknown> = Promise.resolve();
  let nextJobId = 1000;
  let nextValidationId = 1;

  app.addHook('onRequest', async (req) => {
    requests.push({ method: req.method, path: req.url.split('?')[0] ?? req.url });
  });

  // Form-encoded token requests.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.post('/auth/realms/glasstree/protocol/openid-connect/token', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const body = (req.body ?? {}) as Record<string, string>;
    if (body['grant_type'] !== 'client_credentials') return reply.code(400).send({ error: 'unsupported_grant_type', error_description: 'Unsupported grant_type' });
    const [scheme, encoded] = auth.split(' ');
    const decoded = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
    if (decoded !== `${clientKey}:${clientSecret}`) return reply.code(401).send({ error: 'unauthorized_client', error_description: 'Invalid client or Invalid client credentials' });
    const token = randomBytes(24).toString('base64url');
    const ttl = opts.tokenTtlSeconds ?? 3600;
    tokens.set(token, Date.now() + ttl * 1000);
    return { access_token: token, expires_in: ttl, refresh_expires_in: ttl * 2, token_type: 'bearer', scope: 'profile email' };
  });

  /** Bearer gate for every API endpoint; answers 401 itself and returns false. */
  const authed = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const exp = tokens.get(token);
    if (!exp) {
      void reply.code(401).send({ detail: 'Authentication credentials were not provided.' });
      return false;
    }
    if (exp < Date.now()) {
      void reply.code(401).send({ detail: 'Given token not valid for any token type', code: 'token_not_valid' });
      return false;
    }
    return true;
  };

  /** Downloads a source URL the way Lulu would; remembers md5, size and page count. */
  const download = async (url: string): Promise<{ ok: true; md5: string; bytes: number; pages: number } | { ok: false; error: string }> => {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      return { ok: false, error: `Could not download ${url}: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!res.ok) return { ok: false, error: `Could not download ${url}: HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, error: `File at ${url} is not a PDF (${res.headers.get('content-type') ?? 'unknown type'})` };
    let pages = 0;
    try {
      pages = (await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
    } catch (err) {
      return { ok: false, error: `Could not read the PDF at ${url}: ${err instanceof Error ? err.message : String(err)}` };
    }
    const md5 = createHash('md5').update(buf).digest('hex');
    downloads.set(url, { md5, bytes: buf.byteLength, pages });
    return { ok: true, md5, bytes: buf.byteLength, pages };
  };

  app.post<{ Body: { pod_package_id?: string; interior_page_count?: number; unit?: string } }>('/cover-dimensions/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const { pod_package_id, interior_page_count, unit = 'pt' } = req.body ?? {};
    if (!pod_package_id || !interior_page_count) return reply.code(400).send({ pod_package_id: ['This field is required.'] });
    const dims = fakeCoverDimensionsIn(pod_package_id, interior_page_count);
    if (!dims) return reply.code(400).send({ pod_package_id: [`Unknown pod_package_id ${pod_package_id}`] });
    const factor = unit === 'pt' ? 72 : unit === 'mm' ? 25.4 : 1;
    return reply.code(201).send({ width: (dims.width * factor).toFixed(3), height: (dims.height * factor).toFixed(3), unit });
  });

  const validationView = (id: number) => {
    const v = validations.get(id)!;
    const done = v.polls >= 1;
    const status = !done ? (v.kind === 'interior' ? 'VALIDATING' : 'NORMALIZING') : v.ok && !v.errors ? (v.kind === 'interior' ? 'VALIDATED' : 'NORMALIZED') : 'ERROR';
    return {
      id,
      source_url: v.url,
      status,
      errors: status === 'ERROR' ? (v.errors ?? []) : null,
      ...(v.kind === 'interior' ? { page_count: v.pages !== undefined ? String(v.pages) : null, valid_pod_package_ids: null } : {}),
    };
  };

  const startValidation = async (kind: 'interior' | 'cover', url: string | undefined, forced: string[] | undefined) => {
    if (!url) return undefined;
    const id = nextValidationId++;
    const dl = await download(url);
    validations.set(id, { kind, url, polls: 0, errors: forced ?? (dl.ok ? undefined : [dl.error]), pages: dl.ok ? dl.pages : undefined, ok: dl.ok });
    return id;
  };

  app.post<{ Body: { source_url?: string; pod_package_id?: string } }>('/validate-interior/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const id = await startValidation('interior', req.body?.source_url, behaviour.interiorErrors);
    behaviour.interiorErrors = undefined;
    if (id === undefined) return reply.code(400).send({ source_url: ['This field is required.'] });
    // Like the sandbox, the create answer has no status yet; the first poll reports VALIDATING.
    return reply.code(201).send({ ...validationView(id), status: null });
  });
  app.get<{ Params: { id: string } }>('/validate-interior/:id/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const id = Number(req.params.id);
    const v = validations.get(id);
    if (!v || v.kind !== 'interior') return reply.code(404).send({ detail: 'Not found.' });
    v.polls += 1;
    return validationView(id);
  });

  app.post<{ Body: { source_url?: string; pod_package_id?: string; interior_page_count?: number } }>('/validate-cover/', async (req, reply) => {
    if (!authed(req, reply)) return;
    if (!req.body?.pod_package_id || !req.body.interior_page_count) return reply.code(400).send({ interior_page_count: ['This field is required.'] });
    const id = await startValidation('cover', req.body.source_url, behaviour.coverErrors);
    behaviour.coverErrors = undefined;
    if (id === undefined) return reply.code(400).send({ source_url: ['This field is required.'] });
    return reply.code(201).send({ ...validationView(id), status: null });
  });
  app.get<{ Params: { id: string } }>('/validate-cover/:id/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const id = Number(req.params.id);
    const v = validations.get(id);
    if (!v || v.kind !== 'cover') return reply.code(404).send({ detail: 'Not found.' });
    v.polls += 1;
    return validationView(id);
  });

  type LineItemIn = { page_count?: number; pod_package_id?: string; quantity?: number };
  const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  app.post<{ Body: { currency?: string; line_items?: LineItemIn[]; shipping_address?: { country?: string; state?: string } } }>('/shipping-options/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const country = req.body?.shipping_address?.country;
    if (!country || country.length !== 2) return reply.code(400).send({ shipping_address: { country: ['This field is required.'] } });
    if (!req.body?.line_items?.length) return reply.code(400).send({ line_items: ['This field is required.'] });
    const currency = req.body.currency ?? 'USD';
    return SHIPPING.filter((s) => !s.usOnly || country === 'US').map((s, i) => ({
      id: 100 + i,
      level: s.level,
      cost_excl_tax: money(s.cost),
      currency,
      traceable: s.level !== 'MAIL',
      postbox_ok: s.level === 'MAIL',
      home_only: false,
      business_only: false,
      transit_time: s.days[0],
      shipping_buffer: 1,
      min_dispatch_date: isoDay(2),
      max_dispatch_date: isoDay(4),
      min_delivery_date: isoDay(2 + s.days[0]),
      max_delivery_date: isoDay(4 + s.days[1]),
      total_days_min: 2 + s.days[0],
      total_days_max: 4 + s.days[1],
    }));
  });

  const costFor = (lineItems: LineItemIn[], shippingLevel: string, address: { country_code?: string }) => {
    const taxRate = address.country_code === 'US' ? 0.07 : 0;
    const items = lineItems.map((li) => {
      const unit = fakeUnitPrice(li.pod_package_id ?? '', li.page_count ?? 0);
      const qty = li.quantity ?? 1;
      const excl = unit * qty;
      const tax = excl * taxRate;
      return {
        quantity: qty,
        cost_excl_discounts: money(unit),
        unit_tier_cost: null,
        discounts: [],
        tax_rate: taxRate.toFixed(6),
        total_cost_excl_discounts: money(excl),
        total_cost_excl_tax: money(excl),
        total_tax: money(tax),
        total_cost_incl_tax: money(excl + tax),
      };
    });
    const ship = SHIPPING.find((s) => s.level === shippingLevel)?.cost ?? 3.99;
    const shipTax = ship * taxRate;
    const excl = items.reduce((s, i) => s + Number(i.total_cost_excl_tax), 0) + ship;
    const tax = items.reduce((s, i) => s + Number(i.total_tax), 0) + shipTax;
    return {
      currency: 'USD',
      line_item_costs: items,
      shipping_cost: { tax_rate: taxRate.toFixed(6), total_cost_excl_tax: money(ship), total_tax: money(shipTax), total_cost_incl_tax: money(ship + shipTax) },
      fulfillment_cost: { tax_rate: taxRate.toFixed(6), total_cost_excl_tax: '0.00', total_tax: '0.00', total_cost_incl_tax: '0.00' },
      fees: [],
      total_cost_excl_tax: money(excl),
      total_tax: money(tax),
      total_cost_incl_tax: money(excl + tax),
      total_discount_amount: '0.00',
    };
  };

  app.post<{ Body: { line_items?: LineItemIn[]; shipping_address?: Record<string, string>; shipping_option?: string } }>('/print-job-cost-calculations/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const b = req.body ?? {};
    const missing = ['street1', 'city', 'country_code', 'postcode', 'phone_number'].filter((k) => !b.shipping_address?.[k]);
    if (missing.length > 0) return reply.code(400).send({ shipping_address: Object.fromEntries(missing.map((k) => [k, ['This field is required.']])) });
    if (!b.shipping_option) return reply.code(400).send({ shipping_option: ['This field is required.'] });
    if (!b.line_items?.length) return reply.code(400).send({ line_items: ['This field is required.'] });
    return reply.code(201).send({ shipping_address: { ...b.shipping_address, warnings: [] }, ...costFor(b.line_items, b.shipping_option, b.shipping_address ?? {}) });
  });

  const jobView = (job: FakeLuluJob) => {
    const li = (job.body['line_items'] as Array<Record<string, unknown>>) ?? [];
    return {
      id: job.id,
      external_id: job.externalId ?? null,
      contact_email: job.body['contact_email'],
      shipping_level: job.body['shipping_level'],
      shipping_address: job.body['shipping_address'],
      date_created: job.createdAt,
      date_modified: new Date().toISOString(),
      status: { name: job.status, message: job.message, changed: new Date().toISOString() },
      line_items: li.map((item, i) => ({
        id: job.id * 10 + i,
        title: item['title'],
        quantity: item['quantity'],
        // Read-only, on the line item itself (as in Lulu's schema): counted when the interior was downloaded.
        page_count: job.pageCounts?.[i] ?? null,
        pod_package_id: (item['printable_normalization'] as Record<string, unknown> | undefined)?.['pod_package_id'],
        status: { name: job.status === 'SHIPPED' ? 'SHIPPED' : job.status === 'REJECTED' ? 'REJECTED' : job.status === 'IN_PRODUCTION' ? 'IN_PRODUCTION' : 'CREATED', messages: job.trackingUrl ? { tracking_urls: [job.trackingUrl], carrier_name: 'Fake Carrier' } : {} },
        ...(job.trackingUrl ? { tracking_id: `${job.id}_${i}`, tracking_urls: [job.trackingUrl] } : {}),
      })),
      costs: job.status === 'CREATED' ? { line_item_costs: null, shipping_cost: null, total_cost_excl_tax: null, total_cost_incl_tax: null, total_tax: null } : costFor(li as LineItemIn[], String(job.body['shipping_level']), (job.body['shipping_address'] as Record<string, string>) ?? {}),
    };
  };

  app.post<{ Body: Record<string, unknown> }>('/print-jobs/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const b = req.body ?? {};
    const errors: Record<string, unknown> = {};
    if (!b['contact_email']) errors['contact_email'] = ['This field is required.'];
    if (!b['shipping_level']) errors['shipping_level'] = ['This field is required.'];
    const addr = (b['shipping_address'] ?? {}) as Record<string, string>;
    const missing = ['name', 'street1', 'city', 'country_code', 'postcode', 'phone_number'].filter((k) => !addr[k]);
    if (missing.length > 0) errors['shipping_address'] = Object.fromEntries(missing.map((k) => [k, ['This field is required.']]));
    const items = (b['line_items'] ?? []) as Array<Record<string, unknown>>;
    if (items.length === 0) errors['line_items'] = ['This field is required.'];
    if (Object.keys(errors).length > 0) return reply.code(400).send(errors);

    const id = nextJobId++;
    const job: FakeLuluJob = { id, status: 'CREATED', message: STATUS_MESSAGES['CREATED']!, body: b, createdAt: new Date().toISOString(), ...(typeof b['external_id'] === 'string' ? { externalId: b['external_id'] } : {}) };
    jobs.set(id, job);
    // Lulu validates the files after answering; the fake does it inline so the next poll can reject.
    for (const item of items) {
      const pn = item['printable_normalization'] as { interior?: { source_url?: string; source_md5_sum?: string }; cover?: { source_url?: string; source_md5_sum?: string } } | undefined;
      for (const [name, file] of [
        ['interior', pn?.interior],
        ['cover', pn?.cover],
      ] as const) {
        if (!file?.source_url) {
          job.status = 'REJECTED';
          job.message = `Line item is missing the ${name} file`;
          break;
        }
        const dl = await download(file.source_url);
        if (!dl.ok) {
          job.status = 'REJECTED';
          job.message = `${name}: ${dl.error}`;
          break;
        }
        if (name === 'interior') (job.pageCounts ??= [])[items.indexOf(item)] = dl.pages;
        if (file.source_md5_sum && file.source_md5_sum.toLowerCase() !== dl.md5) {
          job.status = 'REJECTED';
          job.message = `${name}: source_md5_sum does not match the downloaded file`;
          break;
        }
      }
    }
    // Lulu's create response carries the bare status name (spec schema for the 201), unlike the detail view.
    return reply.code(201).send({ ...jobView(job), status: job.status });
  });

  /** Lulu signs each submission with the API secret (HMAC-SHA256 over the raw body) and retries failures; the fake sends once. */
  const submit = (topic: string, job: FakeLuluJob): void => {
    for (const hook of webhooks.values()) {
      if (!hook.is_active || !hook.topics.includes(topic)) continue;
      const body = JSON.stringify({ topic, data: jobView(job) });
      const signature = createHmac('sha256', clientSecret).update(body, 'utf8').digest('hex');
      const p = fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json', 'Lulu-HMAC-SHA256': signature }, body, signal: AbortSignal.timeout(5000) })
        .then((res) => deliveries.push({ url: hook.url, status: res.status, topic, jobId: job.id }))
        .catch(() => deliveries.push({ url: hook.url, status: undefined, topic, jobId: job.id }));
      inflight = inflight.then(() => p);
    }
  };

  app.get('/webhooks/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const results = [...webhooks.values()];
    return { count: results.length, results };
  });
  app.post<{ Body: { topics?: string[]; url?: string } }>('/webhooks/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const url = req.body?.url;
    const topics = req.body?.topics ?? [];
    if (!url || !/^https?:\/\//.test(url)) return reply.code(400).send({ url: ['Enter a valid URL.'] });
    if (topics.some((t) => t !== 'PRINT_JOB_STATUS_CHANGED')) return reply.code(400).send({ topics: ['No matching enum type.'] });
    if ([...webhooks.values()].some((h) => h.url === url)) return reply.code(400).send({ url: ['Webhook with this url already exists.'] });
    const hook = { id: randomBytes(8).toString('hex'), url, topics, is_active: true };
    webhooks.set(hook.id, hook);
    return reply.code(201).send(hook);
  });
  app.get<{ Params: { id: string } }>('/webhooks/:id/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const hook = webhooks.get(req.params.id);
    return hook ?? reply.code(404).send({ detail: 'Not found.' });
  });
  app.delete<{ Params: { id: string } }>('/webhooks/:id/', async (req, reply) => {
    if (!authed(req, reply)) return;
    if (!webhooks.delete(req.params.id)) return reply.code(404).send({ detail: 'Not found.' });
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string; topic: string } }>('/webhooks/:id/test-submission/:topic/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const hook = webhooks.get(req.params.id);
    if (!hook) return reply.code(404).send({ detail: 'Not found.' });
    const dummy: FakeLuluJob = { id: 1, status: 'UNPAID', message: STATUS_MESSAGES['UNPAID']!, body: { line_items: [] }, createdAt: new Date().toISOString() };
    submit(req.params.topic, dummy);
    return reply.code(200).send({ ok: true });
  });

  app.get<{ Querystring: { page_size?: string; page?: string } }>('/print-jobs/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const size = Number(req.query.page_size ?? 100) || 100;
    const all = [...jobs.values()].sort((a, b) => b.id - a.id);
    return { count: all.length, next: null, previous: null, results: all.slice(0, size).map(jobView) };
  });

  app.get<{ Params: { id: string } }>('/print-jobs/:id/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const job = jobs.get(Number(req.params.id));
    if (!job) return reply.code(404).send({ detail: 'Not found.' });
    return jobView(job);
  });

  const statusView = (job: FakeLuluJob) => ({
    name: job.status,
    message: job.message,
    changed: new Date().toISOString(),
    print_job_id: job.id,
    ...(job.trackingUrl
      ? { line_item_statuses: [{ name: 'SHIPPED', messages: { tracking_id: `${job.id}_1`, tracking_urls: [job.trackingUrl], carrier_name: 'Fake Carrier' }, line_item_id: job.id * 10 }] }
      : {}),
  });

  app.get<{ Params: { id: string } }>('/print-jobs/:id/status/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const job = jobs.get(Number(req.params.id));
    if (!job) return reply.code(404).send({ detail: 'Not found.' });
    // Each poll sees the next stage, so a refresh button walks a job to SHIPPED in five clicks.
    if (behaviour.advanceOnPoll) {
      const i = STATUS_FLOW.indexOf(job.status);
      if (i >= 0 && i < STATUS_FLOW.length - 1) {
        job.status = STATUS_FLOW[i + 1]!;
        job.message = STATUS_MESSAGES[job.status]!;
        if (job.status === 'SHIPPED') job.trackingUrl = `${url}/printer-wannabe-tracking/${job.id}_1`;
        submit('PRINT_JOB_STATUS_CHANGED', job);
      }
    }
    return statusView(job);
  });

  app.put<{ Params: { id: string }; Body: { name?: string } }>('/print-jobs/:id/status/', async (req, reply) => {
    if (!authed(req, reply)) return;
    const job = jobs.get(Number(req.params.id));
    if (!job) return reply.code(404).send({ detail: 'Not found.' });
    if (req.body?.name !== 'CANCELED') return reply.code(400).send({ name: ['Only CANCELED is allowed.'] });
    if (job.status !== 'CREATED' && job.status !== 'UNPAID') return reply.code(400).send({ detail: `Print-Job in status ${job.status} cannot be canceled` });
    job.status = 'CANCELED';
    job.message = STATUS_MESSAGES['CANCELED']!;
    submit('PRINT_JOB_STATUS_CHANGED', job);
    return statusView(job);
  });

  app.get<{ Params: { id: string } }>('/printer-wannabe-tracking/:id', async (req) => `Parcel ${req.params.id}: out for delivery (fake)`);

  const url = await app.listen({ port: opts.port ?? 0, host: opts.host ?? '127.0.0.1' });
  return { url, app, clientKey, clientSecret, jobs, downloads, behaviour, requests, webhooks, deliveries, webhooksIdle: () => inflight.then(() => undefined), fire: (jobId) => { const j = jobs.get(jobId); if (j) submit('PRINT_JOB_STATUS_CHANGED', j); }, revokeTokens: () => tokens.clear(), close: () => app.close() };
}

// Run directly: node/tsx src/test/fake-lulu.ts [--port N] [--key K] [--secret S]; PORT in the environment also sets the port.
if (process.argv[1] && /fake-lulu\.[tj]s$/.test(process.argv[1])) {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  startFakeLulu({ port: Number(arg('port') ?? process.env['PORT'] ?? 2390), clientKey: arg('key') ?? 'fake-key', clientSecret: arg('secret') ?? 'fake-secret', logger: true })
    .then((s) => console.log(`fake Lulu listening at ${s.url}; credentials ${s.clientKey} / ${s.clientSecret}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

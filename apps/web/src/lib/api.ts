import type { z } from 'zod';

/** Thrown for any non-2xx response. `body` is the parsed JSON when the server sent some. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(e)) return e.message || `Request failed (${e.status})`;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions<T> {
  method?: Method;
  body?: unknown;
  /** Zod schema used to validate the JSON response. */
  schema?: z.ZodType<T>;
  signal?: AbortSignal | undefined;
}

function extractMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      const v = b[key];
      if (typeof v === 'string' && v) return v;
    }
  }
  if (typeof body === 'string' && body.trim()) return body.slice(0, 200);
  switch (status) {
    case 400:
      return 'Bad request';
    case 401:
      return 'Not signed in';
    case 403:
      return 'Not allowed';
    case 404:
      return 'Not found';
    case 502:
    case 503:
    case 504:
      return 'The server could not reach Immich';
    default:
      return `Request failed (${status})`;
  }
}

function onUnauthorized(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  const next = window.location.pathname + window.location.search;
  const target = next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
  window.location.assign(target);
}

/**
 * Typed fetch wrapper for the Bookbinder API.
 * - JSON in / JSON out, cookie session (same origin).
 * - Throws ApiError on non-2xx.
 * - 401 redirects to /login (except while already on /login).
 * - Optionally validates the response with a zod schema. Validation failures are
 *   logged and the raw payload is returned, so a minor server drift never blanks the UI.
 */
export async function api<T = unknown>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, schema, signal } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Could not reach the Bookbinder server');
  }

  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, extractMessage(payload, 401), payload);
  }
  if (!res.ok) {
    throw new ApiError(res.status, extractMessage(payload, res.status), payload);
  }

  if (schema) {
    const parsed = schema.safeParse(payload);
    if (parsed.success) return parsed.data;
    console.warn(`[api] ${method} ${path}: response did not match schema`, parsed.error.issues);
  }
  return payload as T;
}

export const get = <T>(path: string, schema?: z.ZodType<T>, signal?: AbortSignal) =>
  api<T>(path, { method: 'GET', ...(schema ? { schema } : {}), signal });
export const post = <T>(path: string, body?: unknown, schema?: z.ZodType<T>) =>
  api<T>(path, { method: 'POST', ...(body !== undefined ? { body } : {}), ...(schema ? { schema } : {}) });
export const put = <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
  api<T>(path, { method: 'PUT', body, ...(schema ? { schema } : {}) });
export const del = <T>(path: string, schema?: z.ZodType<T>) =>
  api<T>(path, { method: 'DELETE', ...(schema ? { schema } : {}) });

/** URL for an Immich asset thumbnail proxied through the server. */
export function thumbnailUrl(assetId: string, size: 'thumbnail' | 'preview' = 'thumbnail'): string {
  return `/api/immich/assets/${encodeURIComponent(assetId)}/thumbnail?size=${size}`;
}

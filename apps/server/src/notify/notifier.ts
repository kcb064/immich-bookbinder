import type { NotificationEvents, NotifyEventKind, NotifyKind } from '@bookbinder/shared';
import type { FastifyBaseLogger } from 'fastify';

/** What a notification says; the notifier formats it for the configured service. */
export interface NotifyEvent {
  kind: NotifyEventKind;
  title: string;
  message: string;
  /** 'error' raises the priority (ntfy/gotify) so a failed render or order stands out. */
  level?: 'info' | 'error';
  bookId?: string | undefined;
  bookTitle?: string | undefined;
  /** A path on the app (the notifier prefixes the public URL when one is configured). */
  path?: string | undefined;
}

export interface NotifierTarget {
  kind: NotifyKind;
  url: string;
  /** ntfy access token (Bearer), Gotify application token, or a bearer token sent to a webhook. */
  token?: string | undefined;
  events: NotificationEvents;
}

export interface NotifierDeps {
  /** The stored target, or undefined when notifications are off. */
  target: () => NotifierTarget | undefined;
  /** Public origin for links in the message, if any. */
  publicBase: () => string | undefined;
  log: FastifyBaseLogger;
  fetch?: typeof globalThis.fetch;
  /** Delay before the single retry (default 2 s; tests shorten it). */
  retryDelayMs?: number;
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Which setting gates an event kind. */
const EVENT_SWITCH: Record<NotifyEventKind, keyof NotificationEvents> = {
  'render-done': 'renderDone',
  'render-failed': 'renderDone',
  'order-status': 'orderStatus',
  'selection-failed': 'selectionFailed',
  test: 'renderDone',
};

/**
 * Sends short notifications to ntfy, Gotify or any webhook (M7). Fire-and-forget: `notify` never
 * throws or blocks the caller; a failed delivery is retried once and then logged. No queue table.
 */
export class Notifier {
  private readonly fetchImpl: typeof globalThis.fetch;
  private inflight: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: NotifierDeps) {
    this.fetchImpl = deps.fetch ?? globalThis.fetch;
  }

  /** The stored target, or undefined when notifications are off. */
  currentTarget(): NotifierTarget | undefined {
    return this.deps.target();
  }

  /** Whether an event of this kind would be sent right now. */
  enabled(kind: NotifyEventKind): boolean {
    const target = this.deps.target();
    return Boolean(target && (kind === 'test' || target.events[EVENT_SWITCH[kind]]));
  }

  /** Queues a delivery (with one retry) and returns immediately. */
  notify(event: NotifyEvent): void {
    if (!this.enabled(event.kind)) return;
    this.inflight = this.inflight
      .then(() => this.deliver(event))
      .then((r) => {
        if (!r.ok) this.deps.log.warn({ event: event.kind, ...r }, 'notification failed');
      })
      .catch(() => undefined);
  }

  /** Resolves once every queued delivery has been attempted (tests, shutdown). */
  idle(): Promise<void> {
    return this.inflight.then(() => undefined);
  }

  /** Sends one event now (the Settings test button): the result of the first attempt, retried once on failure. */
  async deliver(event: NotifyEvent, target = this.deps.target()): Promise<DeliveryResult> {
    if (!target) return { ok: false, error: 'Notifications are not configured' };
    const first = await this.attempt(event, target);
    if (first.ok) return first;
    await new Promise((r) => setTimeout(r, this.deps.retryDelayMs ?? 2000));
    const second = await this.attempt(event, target);
    return second.ok ? second : { ...second, error: `${second.error ?? 'failed'} (after one retry)` };
  }

  private link(event: NotifyEvent): string | undefined {
    const base = this.deps.publicBase();
    return base && event.path ? `${base}${event.path}` : undefined;
  }

  private async attempt(event: NotifyEvent, target: NotifierTarget): Promise<DeliveryResult> {
    const link = this.link(event);
    const message = link ? `${event.message}\n${link}` : event.message;
    const priority = event.level === 'error' ? 'high' : 'default';
    let url = target.url;
    let init: RequestInit;
    switch (target.kind) {
      case 'ntfy': {
        // The URL is the topic (https://ntfy.sh/bookbinder); the body is the message.
        const headers: Record<string, string> = { Title: event.title, Priority: priority, Tags: event.level === 'error' ? 'warning' : 'books', 'Content-Type': 'text/plain; charset=utf-8' };
        if (link) headers.Click = link;
        if (target.token) headers.Authorization = `Bearer ${target.token}`;
        init = { method: 'POST', headers, body: message };
        break;
      }
      case 'gotify': {
        // The URL is the server; the application token goes in the header.
        url = `${target.url.replace(/\/+$/, '')}/message`;
        init = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(target.token ? { 'X-Gotify-Key': target.token } : {}) },
          body: JSON.stringify({ title: event.title, message, priority: event.level === 'error' ? 8 : 4, ...(link ? { extras: { 'client::notification': { click: { url: link } } } } : {}) }),
        };
        break;
      }
      default: {
        init = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'immich-bookbinder', ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}) },
          body: JSON.stringify({
            event: event.kind,
            title: event.title,
            message: event.message,
            level: event.level ?? 'info',
            at: new Date().toISOString(),
            ...(event.bookId ? { bookId: event.bookId } : {}),
            ...(event.bookTitle ? { bookTitle: event.bookTitle } : {}),
            ...(link ? { url: link } : {}),
          }),
        };
      }
    }
    try {
      const res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { ok: false, status: res.status, error: `${target.kind} answered HTTP ${res.status}` };
      return { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

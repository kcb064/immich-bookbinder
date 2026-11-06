import { FORMAT_PRESETS, formatDateRangeIn, formatDateTimeIn, formatMoneyIn, formatNumberIn, resolveTheme } from '@bookbinder/shared';
import type { Book, BookStatus, LuluBinding, Locale, OrderStatus, Theme, ThemeOverrides } from '@bookbinder/shared';

/** UI locale passed in by callers (M8); defaults to English so existing call sites stay stable. */
export const formatNumber = (n: number | undefined | null, locale: Locale = 'en'): string =>
  n === undefined || n === null ? '—' : formatNumberIn(locale, n);

/** "8.5 × 8.5 in" for a format id; falls back to the raw id when unknown. */
export function formatTrim(formatId: string): string {
  const f = FORMAT_PRESETS[formatId];
  if (!f) return formatId;
  return `${trimNumber(f.trimWidthIn)} × ${trimNumber(f.trimHeightIn)} in`;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

const BINDING_NAMES: Record<LuluBinding, string> = {
  CW: 'Hardcover',
  LW: 'Linen wrap',
  PB: 'Softcover',
  CO: 'Coil bound',
  SS: 'Saddle stitch',
};

export function bindingName(binding: LuluBinding | undefined, formatId: string): string {
  const f = FORMAT_PRESETS[formatId];
  if (f && f.vendor !== 'lulu') return 'Home print';
  return binding ? BINDING_NAMES[binding] : 'Hardcover';
}

/** Pages shown on a card: real pages if laid out, else the rules target. */
export function bookPageCount(book: Pick<Book, 'pages' | 'rules'>): number {
  if (book.pages.length > 0) return book.pages.length;
  return book.rules?.targetPages ?? DEFAULT_TARGET_PAGES;
}

export const DEFAULT_TARGET_PAGES = 48;

interface BookMetaInput {
  formatId: string;
  /** Laid-out pages; 0 means nothing is laid out yet and the target is shown. */
  pageCount: number;
  targetPages?: number | undefined;
  binding?: LuluBinding | undefined;
}

/** "48 pages · 8.5 × 8.5 in · Hardcover" — works for both a full Book and a list summary. */
export function bookMeta(input: BookMetaInput): string {
  const pages = input.pageCount > 0 ? input.pageCount : (input.targetPages ?? DEFAULT_TARGET_PAGES);
  return [`${pages} pages`, formatTrim(input.formatId), bindingName(input.binding, input.formatId)].join(' · ');
}

export function bookMetaFromBook(book: Book): string {
  return bookMeta({
    formatId: book.formatId,
    pageCount: book.pages.length,
    targetPages: book.rules?.targetPages,
    binding: book.luluProduct?.binding,
  });
}

/** The theme a book draws with, overrides applied (M7); a bare id gives the theme itself. */
export function themeFor(book: string | { themeId: string; themeOverrides?: ThemeOverrides | undefined }): Theme {
  return typeof book === 'string' ? resolveTheme(book) : resolveTheme(book.themeId, book.themeOverrides);
}

export type ChipTone = 'neutral' | 'accent' | 'green' | 'amber' | 'red';

export const STATUS_LABELS: Record<BookStatus, string> = {
  draft: 'Draft',
  selecting: 'Selecting',
  editing: 'Editing',
  rendering: 'Rendering',
  rendered: 'Ready',
  ordered: 'Ordered',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  validating: 'Validating files',
  quoted: 'Quoted',
  submitted: 'Submitted',
  unpaid: 'Awaiting payment',
  'in-production': 'In production',
  shipped: 'Shipped',
  rejected: 'Rejected',
  error: 'Error',
  canceled: 'Canceled',
};

export const ORDER_STATUS_TONES: Record<OrderStatus, ChipTone> = {
  draft: 'neutral',
  validating: 'accent',
  quoted: 'accent',
  submitted: 'amber',
  unpaid: 'amber',
  'in-production': 'green',
  shipped: 'green',
  rejected: 'red',
  error: 'red',
  canceled: 'neutral',
};

/** "12.34 USD" / "12,34 USD" from Lulu's decimal strings; the currency code stays visible because Lulu prices in several. */
export function formatMoney(amount: string | number | undefined, currency: string | undefined, locale: Locale = 'en'): string {
  return formatMoneyIn(locale, amount, currency);
}

export const STATUS_TONES: Record<BookStatus, ChipTone> = {
  draft: 'neutral',
  selecting: 'accent',
  editing: 'accent',
  rendering: 'amber',
  rendered: 'green',
  ordered: 'green',
};

function parseDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function formatDate(s: string | null | undefined, locale: Locale = 'en'): string {
  const d = parseDate(s);
  if (!d) return '—';
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

export function formatDateTime(s: string | null | undefined, locale: Locale = 'en'): string {
  return formatDateTimeIn(locale, s);
}

/** Locale-aware range, e.g. "May 12 – 21, 2026" (en) or "12.–21. Mai 2026" (de); a single date when one end is missing, "" when both are. */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined, locale: Locale = 'en'): string {
  if (!start && !end) return '';
  return formatDateRangeIn(locale, start ?? undefined, end ?? undefined);
}

/** Strip scheme and trailing slash for compact display: "immich_server:2283". */
export function compactUrl(url: string | undefined): string {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export function pluralize(n: number, one: string, many = `${one}s`, locale: Locale = 'en'): string {
  return `${formatNumber(n, locale)} ${n === 1 ? one : many}`;
}

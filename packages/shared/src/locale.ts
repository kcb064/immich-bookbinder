import { z } from 'zod';

/**
 * Locales the app speaks (M8). `en` is the historical default; `de` localises the UI and the
 * photo book (chapter titles, date ranges, captions, colophon). Place names come from Immich's
 * reverse geocoding and are shown as Immich returns them; dates and numbers go through Intl
 * with the locale's BCP-47 tag.
 */
export const Locale = z.enum(['en', 'de']);
export type Locale = z.infer<typeof Locale>;

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALES: readonly Locale[] = ['en', 'de'];

export const LOCALE_LABELS: Record<Locale, string> = { en: 'English', de: 'Deutsch' };

/** Normalises anything stored or sent to a supported locale. */
export function normalizeLocale(value: string | null | undefined): Locale {
  if (value === 'de' || value === 'de-DE' || value === 'de-AT' || value === 'de-CH') return 'de';
  return 'en';
}

/** The BCP-47 tag Intl expects: de -> de-DE, en -> en-US. Dates in books are read in UTC. */
export function bcp47(locale: Locale): string {
  return locale === 'de' ? 'de-DE' : 'en-US';
}

const dateCache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: Locale, options: Intl.DateTimeFormatOptions, utc: boolean): Intl.DateTimeFormat {
  const key = `${bcp47(locale)}|${JSON.stringify(options)}|${utc}`;
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(bcp47(locale), utc ? { ...options, timeZone: 'UTC' } : options);
    dateCache.set(key, f);
  }
  return f;
}

function parseIso(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "May 12, 2026" / "12. Mai 2026"; empty when unknown. Read in UTC (book dates are UTC). */
export function formatDateIn(locale: Locale, iso: string | undefined): string {
  const d = parseIso(iso);
  return d ? fmt(locale, { year: 'numeric', month: 'long', day: 'numeric' }, true).format(d) : '';
}

/** Short numeric date for the UI: "5/12/2026" (en) / "12.05.2026" (de). */
export function formatShortDateIn(locale: Locale, iso: string | null | undefined): string {
  const d = parseIso(iso ?? undefined);
  return d ? fmt(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }, false).format(d) : '—';
}

/** Date + time for the UI: "May 12, 2:04 PM" / "12. Mai, 14:04". */
export function formatDateTimeIn(locale: Locale, iso: string | null | undefined): string {
  const d = parseIso(iso ?? undefined);
  return d ? fmt(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, false).format(d) : '—';
}

/**
 * Locale-aware range, e.g. "May 12 – 21, 2026" (en) or "12.–21. Mai 2026" (de); a single date when
 * both ends are the same day or one end is missing. Dates are read in UTC. Intl's narrow-space
 * dashes are replaced by plain spaces so every font renders them.
 */
export function formatDateRangeIn(locale: Locale, lo: string | undefined, hi: string | undefined): string {
  const a = parseIso(lo);
  const b = parseIso(hi);
  if (!a && !b) return '';
  if (!a || !b) return fmt(locale, { year: 'numeric', month: 'long', day: 'numeric' }, true).format((a ?? b)!);
  const [s, e] = a <= b ? [a, b] : [b, a];
  if (s.toISOString().slice(0, 10) === e.toISOString().slice(0, 10)) {
    return fmt(locale, { year: 'numeric', month: 'long', day: 'numeric' }, true).format(s);
  }
  const range = fmt(locale, { year: 'numeric', month: 'long', day: 'numeric' }, true).formatRange(s, e);
  if (locale === 'de') {
    // de-DE yields "12.–21. Mai 2026" already; just normalise the dashes/spaces.
    return range.replace(/[  ]/g, ' ');
  }
  if (s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth()) {
    const month = fmt(locale, { month: 'long', timeZone: 'UTC' } as Intl.DateTimeFormatOptions, true).format(s);
    return `${month} ${s.getUTCDate()} – ${e.getUTCDate()}, ${s.getUTCFullYear()}`;
  }
  return range.replace(/[  ]/g, ' ');
}

/** Grouped number: "1,234" (en) / "1.234" (de). */
export function formatNumberIn(locale: Locale, n: number): string {
  return new Intl.NumberFormat(bcp47(locale)).format(n);
}

/** Money with the currency code visible: "12.34 USD" / "12,34 USD". */
export function formatMoneyIn(locale: Locale, amount: string | number | undefined, currency: string | undefined): string {
  if (amount === undefined || amount === null || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  try {
    return new Intl.NumberFormat(bcp47(locale), { style: 'currency', currency: currency ?? 'USD', currencyDisplay: 'code' }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

/** n of one thing: "1 photograph" / "1 Fotografie", "3 photographs" / "3 Fotografien". */
export function pluralIn(locale: Locale, n: number, one: string, many?: string): string {
  const word = n === 1 ? one : (many ?? `${one}s`);
  return `${formatNumberIn(locale, n)} ${word}`;
}

/** "1 photograph" / "182 photographs" localized, for the colophon. */
export function photographsLabelIn(locale: Locale, n: number): string {
  return locale === 'de' ? pluralIn(locale, n, 'Fotografie', 'Fotografien') : pluralIn(locale, n, 'photograph', 'photographs');
}

/** Chapter titles for day chapters: "Day 3" / "Tag 3", "Days 3–4" / "Tage 3–4", "Undated" / "Ohne Datum". */
export function dayChapterTitleIn(locale: Locale, first: number, last: number | undefined): string {
  if (locale === 'de') {
    if (last === undefined || last === first) return `Tag ${first}`;
    return `Tage ${first}–${last}`;
  }
  if (last === undefined || last === first) return `Day ${first}`;
  return `Days ${first}–${last}`;
}

export const UNDATED_LABELS: Record<Locale, string> = { en: 'Undated', de: 'Ohne Datum' };

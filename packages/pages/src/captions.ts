import type { BookAsset, Locale } from '@bookbinder/shared';
import { formatDateIn, formatDateRangeIn, photographsLabelIn } from '@bookbinder/shared';

function parse(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "May 12, 2026" / "12. Mai 2026" */
export function formatTakenDate(iso: string | undefined, locale: Locale = 'en'): string {
  return formatDateIn(locale, iso);
}

/** "May 12 – 21, 2026" / "12.–21. Mai 2026", "" when unknown. */
export function dateRangeLabel(assets: Iterable<Pick<BookAsset, 'takenAt'>>, locale: Locale = 'en'): string {
  let lo: string | undefined;
  let hi: string | undefined;
  for (const a of assets) {
    if (!parse(a.takenAt)) continue;
    if (!lo || a.takenAt! < lo) lo = a.takenAt;
    if (!hi || a.takenAt! > hi) hi = a.takenAt;
  }
  return formatDateRangeIn(locale, lo, hi);
}

/** Place for a photo: "Lisbon, Portugal" / "Lisbon" / "Portugal" / "". Names come from Immich as-is. */
export function placeLabel(asset: Pick<BookAsset, 'city' | 'country'> | undefined): string {
  if (!asset) return '';
  return [asset.city, asset.country].filter((s): s is string => Boolean(s && s.trim())).join(', ');
}

/**
 * Caption for a page's photos when the user has not written one: the Immich description of the
 * first photo that has one, else "Place · Date" of the first photo.
 */
export function autoCaption(assets: readonly (BookAsset | undefined)[], locale: Locale = 'en'): string {
  const present = assets.filter((a): a is BookAsset => a !== undefined);
  const described = present.find((a) => a.description && a.description.trim());
  if (described?.description) return described.description.trim();
  const first = present[0];
  if (!first) return '';
  const parts = [placeLabel(first), formatTakenDate(first.takenAt, locale)].filter(Boolean);
  return parts.join(' · ');
}

/** "182 photographs" / "182 Fotografien" */
export function photographsLabel(n: number, locale: Locale = 'en'): string {
  return photographsLabelIn(locale, n);
}

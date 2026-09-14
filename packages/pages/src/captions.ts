import type { BookAsset } from '@bookbinder/shared';

const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long' });

function parse(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "May 12, 2026" */
export function formatTakenDate(iso: string | undefined): string {
  const d = parse(iso);
  return d ? dateFmt.format(d) : '';
}

/** "May 12 – 21, 2026", "May 2026" when the range spans a month with no exact days, "" when unknown. */
export function dateRangeLabel(assets: Iterable<Pick<BookAsset, 'takenAt'>>): string {
  let lo: Date | undefined;
  let hi: Date | undefined;
  for (const a of assets) {
    const d = parse(a.takenAt);
    if (!d) continue;
    if (!lo || d < lo) lo = d;
    if (!hi || d > hi) hi = d;
  }
  if (!lo || !hi) return '';
  if (lo.toDateString() === hi.toDateString()) return dateFmt.format(lo);
  if (lo.getFullYear() === hi.getFullYear() && lo.getMonth() === hi.getMonth()) {
    return `${monthFmt.format(lo).split(' ')[0]} ${lo.getDate()} – ${hi.getDate()}, ${lo.getFullYear()}`;
  }
  return dateFmt.formatRange(lo, hi);
}

/** Place for a photo: "Lisbon, Portugal" / "Lisbon" / "Portugal" / "". */
export function placeLabel(asset: Pick<BookAsset, 'city' | 'country'> | undefined): string {
  if (!asset) return '';
  return [asset.city, asset.country].filter((s): s is string => Boolean(s && s.trim())).join(', ');
}

/**
 * Caption for a page's photos when the user has not written one: the Immich description of the
 * first photo that has one, else "Place · Date" of the first photo.
 */
export function autoCaption(assets: readonly (BookAsset | undefined)[]): string {
  const present = assets.filter((a): a is BookAsset => a !== undefined);
  const described = present.find((a) => a.description && a.description.trim());
  if (described?.description) return described.description.trim();
  const first = present[0];
  if (!first) return '';
  const parts = [placeLabel(first), formatTakenDate(first.takenAt)].filter(Boolean);
  return parts.join(' · ');
}

/** "182 photographs" */
export function photographsLabel(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'photograph' : 'photographs'}`;
}

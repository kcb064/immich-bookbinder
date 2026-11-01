import { describe, expect, it } from 'vitest';
import {
  dayChapterTitleIn,
  formatDateRangeIn,
  formatDateTimeIn,
  formatMoneyIn,
  formatNumberIn,
  formatShortDateIn,
  normalizeLocale,
  photographsLabelIn,
} from './locale.js';

describe('locale', () => {
  it('normalises BCP-47 tags to the supported locales', () => {
    expect(normalizeLocale('de')).toBe('de');
    expect(normalizeLocale('de-DE')).toBe('de');
    expect(normalizeLocale('de-AT')).toBe('de');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr-FR')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
  });

  it('formats single dates per locale (UTC for book dates)', () => {
    expect(formatDateRangeIn('en', '2026-05-12T10:00:00Z', '2026-05-12T18:00:00Z')).toBe('May 12, 2026');
    expect(formatDateRangeIn('de', '2026-05-12T10:00:00Z', '2026-05-12T18:00:00Z')).toBe('12. Mai 2026');
  });

  it('formats ranges per locale', () => {
    const en = formatDateRangeIn('en', '2026-05-12T00:00:00Z', '2026-05-21T00:00:00Z');
    expect(en).toBe('May 12 – 21, 2026');
    const de = formatDateRangeIn('de', '2026-05-12T00:00:00Z', '2026-05-21T00:00:00Z');
    expect(de).toBe('12.–21. Mai 2026');
    const crossYear = formatDateRangeIn('de', '2026-12-30T00:00:00Z', '2027-01-02T00:00:00Z');
    expect(crossYear).toContain('2026');
    expect(crossYear).toContain('2027');
    expect(formatDateRangeIn('en', undefined, undefined)).toBe('');
  });

  it('formats numbers and money per locale', () => {
    expect(formatNumberIn('en', 1234567)).toBe('1,234,567');
    expect(formatNumberIn('de', 1234567)).toBe('1.234.567');
    expect(formatMoneyIn('en', '12.34', 'USD')).toBe('USD 12.34');
    expect(formatMoneyIn('de', '12.34', 'EUR')).toBe('12,34 EUR');
  });

  it('formats UI date-times per locale', () => {
    expect(formatDateTimeIn('en', '2026-05-12T14:04:00Z')).toMatch(/May 12, 2026/);
    expect(formatShortDateIn('de', '2026-05-12T14:04:00Z')).toBe('12.05.2026');
    expect(formatShortDateIn('en', '2026-05-12T14:04:00Z')).toBe('05/12/2026');
  });

  it('labels day chapters and photo counts per locale', () => {
    expect(dayChapterTitleIn('en', 3, undefined)).toBe('Day 3');
    expect(dayChapterTitleIn('en', 3, 4)).toBe('Days 3–4');
    expect(dayChapterTitleIn('de', 3, undefined)).toBe('Tag 3');
    expect(dayChapterTitleIn('de', 3, 4)).toBe('Tage 3–4');
    expect(photographsLabelIn('en', 182)).toBe('182 photographs');
    expect(photographsLabelIn('de', 182)).toBe('182 Fotografien');
    expect(photographsLabelIn('de', 1)).toBe('1 Fotografie');
  });
});

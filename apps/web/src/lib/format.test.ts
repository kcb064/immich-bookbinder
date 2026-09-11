import { describe, expect, it } from 'vitest';
import { Book } from '@bookbinder/shared';
import { bookMeta, bookMetaFromBook, compactUrl, formatDateRange, formatTrim } from './format.ts';

const base = {
  id: 'b1',
  title: 'Portugal',
  formatId: 'lulu-square-8.5',
  themeId: 'warm-editorial',
  createdAt: '2026-09-11T10:00:00.000Z',
  updatedAt: '2026-09-11T10:00:00.000Z',
};

describe('bookMeta', () => {
  it('uses the rules target when no pages are laid out', () => {
    const book = Book.parse({ ...base, rules: { sources: [{ kind: 'album', albumIds: ['a'] }], targetPages: 48 } });
    expect(bookMetaFromBook(book)).toBe('48 pages · 8.5 × 8.5 in · Hardcover');
  });

  it('formats a list summary with laid-out pages', () => {
    expect(bookMeta({ formatId: 'lulu-small-square-7.5', pageCount: 32, binding: 'PB' })).toBe('32 pages · 7.5 × 7.5 in · Softcover');
    expect(bookMeta({ formatId: 'lulu-square-8.5', pageCount: 0 })).toBe('48 pages · 8.5 × 8.5 in · Hardcover');
  });

  it('falls back to the raw format id and default binding', () => {
    const book = Book.parse({ ...base, formatId: 'mystery' });
    expect(bookMetaFromBook(book)).toBe('48 pages · mystery · Hardcover');
  });

  it('labels home-print formats', () => {
    const book = Book.parse({ ...base, formatId: 'home-letter' });
    expect(bookMetaFromBook(book)).toBe('48 pages · 8.5 × 11 in · Home print');
  });
});

describe('formatTrim', () => {
  it('trims trailing zeros', () => {
    expect(formatTrim('lulu-letter-landscape')).toBe('11 × 8.5 in');
    expect(formatTrim('lulu-a4-portrait')).toBe('8.27 × 11.69 in');
  });
});

describe('formatDateRange', () => {
  it('collapses same-month ranges', () => {
    const s = formatDateRange('2026-05-12T12:00:00Z', '2026-05-21T12:00:00Z');
    // Locale-agnostic: one "May", both days, one year, joined by an en dash.
    expect(s).toMatch(/–/);
    expect(s.match(/May/g)).toHaveLength(1);
    expect(s).toMatch(/12/);
    expect(s).toMatch(/21/);
    expect(s.match(/2026/g)).toHaveLength(1);
  });
  it('handles a single date', () => {
    const s = formatDateRange('2026-05-12T12:00:00Z', undefined);
    expect(s).toMatch(/May/);
    expect(s).toMatch(/12/);
    expect(s).toMatch(/2026/);
    expect(s).not.toContain('–');
    expect(formatDateRange(undefined, undefined)).toBe('');
  });
});

describe('compactUrl', () => {
  it('strips scheme and trailing slash', () => {
    expect(compactUrl('http://immich_server:2283/')).toBe('immich_server:2283');
    expect(compactUrl(undefined)).toBe('');
  });
});

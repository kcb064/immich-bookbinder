import type { Page } from '@bookbinder/shared';

/** One opening of the book: page 0 sits alone on the right, then pairs (1,2), (3,4), ... */
export interface Spread {
  index: number;
  left: Page | undefined;
  right: Page | undefined;
  /** Printed page numbers (1-based) of left/right. */
  leftNumber: number | undefined;
  rightNumber: number | undefined;
}

export function toSpreads(pages: readonly Page[]): Spread[] {
  const out: Spread[] = [];
  if (pages.length === 0) return out;
  out.push({ index: 0, left: undefined, right: pages[0], leftNumber: undefined, rightNumber: 1 });
  for (let i = 1; i < pages.length; i += 2) {
    const left = pages[i];
    const right = pages[i + 1];
    out.push({
      index: out.length,
      left,
      right,
      leftNumber: left ? i + 1 : undefined,
      rightNumber: right ? i + 2 : undefined,
    });
  }
  return out;
}

/** Index of the spread that shows page `pageIndex`. */
export function spreadIndexOfPage(pageIndex: number): number {
  return pageIndex === 0 ? 0 : Math.floor((pageIndex - 1) / 2) + 1;
}

/** "pages 12–13", "page 1" */
export function spreadLabel(spread: Spread): string {
  if (spread.leftNumber !== undefined && spread.rightNumber !== undefined) return `pages ${spread.leftNumber}–${spread.rightNumber}`;
  const n = spread.leftNumber ?? spread.rightNumber;
  return n === undefined ? '' : `page ${n}`;
}

import type { Book, BookAsset, BookFormat, Preflight, PreflightItem, RenderData, RenderKind } from '@bookbinder/shared';
import { effectivePpi } from './crop.js';
import { pageSlots } from './design.js';

/** Effective ppi thresholds: below WARN the print looks soft, below ERROR visibly so. */
export const PPI_WARN = 200;
export const PPI_ERROR = 150;

/** The subset of a render row preflight needs. */
export interface PreflightRender {
  kind: RenderKind;
  status: string;
  finishedAt?: string | undefined;
  pageCount?: number | undefined;
  data?: RenderData | undefined;
}

export interface PreflightInput {
  book: Pick<Book, 'pages' | 'cover' | 'updatedAt'>;
  format: BookFormat;
  assets: ReadonlyMap<string, Pick<BookAsset, 'width' | 'height' | 'fileName'>>;
  renders: readonly PreflightRender[];
}

/** Slot geometry may sit on the safety line by design; only real crossings count. */
const SAFETY_TOLERANCE_IN = 0.02;

/**
 * Print readiness of a book, in a fixed order: page count, empty slots, resolution, captions in the
 * safety band, cover (Lulu formats), and whether a current print render exists. Pure: the route
 * gathers assets and render rows. `ok` means no errors; warnings are the user's call.
 */
export function preflightBook(input: PreflightInput): Preflight {
  const { book, format, assets, renders } = input;
  const items: PreflightItem[] = [];
  const pages = [...book.pages].sort((a, b) => a.index - b.index);
  const n = pages.length;

  if (n < format.minPages || n > format.maxPages || n % format.pageMultiple !== 0) {
    const rule =
      n < format.minPages
        ? `at least ${format.minPages}`
        : n > format.maxPages
          ? `at most ${format.maxPages}`
          : `a multiple of ${format.pageMultiple}`;
    items.push({ level: 'error', code: 'page-count', message: `${n} pages; ${format.name} needs ${rule}.` });
  }

  for (const page of pages) {
    const hasPhotos = page.slots.some((s) => s.assetId);
    // Effective geometry: a hand-placed frame (M6) replaces the template box, ad-hoc boxes count too.
    for (const { spec: slot, content: c } of pageSlots(page)) {
      if (slot.role === 'hero' || slot.role === 'photo') {
        if (!c?.assetId) {
          items.push({ level: 'warn', code: 'empty-slot', message: `Page ${page.index + 1} has an empty photo slot.`, pageIndex: page.index, slotId: slot.id });
          continue;
        }
        const asset = assets.get(c.assetId);
        if (!asset?.width || !asset.height) continue;
        const ppi = effectivePpi(asset.width, asset.height, slot.w * format.trimWidthIn, slot.h * format.trimHeightIn, c.crop);
        if (ppi < PPI_ERROR || ppi < PPI_WARN) {
          items.push({
            level: ppi < PPI_ERROR ? 'error' : 'warn',
            code: 'low-resolution',
            message: `${asset.fileName ?? 'A photo'} on page ${page.index + 1} prints at ${Math.round(ppi)} ppi (${ppi < PPI_ERROR ? 'visibly soft' : 'slightly soft'}; ${PPI_WARN}+ is safe).`,
            pageIndex: page.index,
            slotId: slot.id,
          });
        }
      } else if (slot.role === 'caption' && (c?.text || hasPhotos)) {
        if (crossesSafety(slot, format, page.index)) {
          items.push({
            level: 'warn',
            code: 'caption-safety',
            message: `The caption on page ${page.index + 1} reaches into the ${format.safetyIn} in safety band and may be trimmed.`,
            pageIndex: page.index,
            slotId: slot.id,
          });
        }
      }
    }
  }

  const done = (kind: RenderKind) => renders.filter((r) => r.kind === kind && r.status === 'done').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  if (format.vendor === 'lulu') {
    if (!book.cover) {
      items.push({ level: 'error', code: 'cover-missing', message: 'The book has no cover yet. Lay the book out again or set one on the book page.' });
    } else {
      const cover = done('cover')[0];
      if (!cover) {
        items.push({ level: 'warn', code: 'cover-missing', message: 'No cover PDF has been rendered yet.' });
      } else if (cover.data?.cover && cover.data.cover.pageCount !== n) {
        items.push({
          level: 'warn',
          code: 'cover-stale',
          message: `The cover PDF was sized for ${cover.data.cover.pageCount} pages; the book now has ${n}, so the spine width changed. Render the cover again.`,
        });
      } else if (cover.finishedAt && cover.finishedAt < book.updatedAt) {
        items.push({ level: 'warn', code: 'cover-stale', message: 'The book changed after the cover PDF was rendered. Render the cover again.' });
      }
    }
  }

  const print = done('print')[0];
  if (!print) items.push({ level: 'warn', code: 'render-missing', message: 'No print PDF has been rendered yet.' });
  else if (print.finishedAt && print.finishedAt < book.updatedAt) {
    items.push({ level: 'warn', code: 'render-missing', message: 'The book changed after the last print PDF. Render it again before ordering.' });
  }

  return { ok: !items.some((i) => i.level === 'error'), items };
}

/**
 * Whether a slot's box reaches into the safety band: `safetyIn` from the three outer trim edges and
 * `max(safetyIn, gutterSafetyIn)` from the spine side (recto pages have the spine on their left).
 */
function crossesSafety(slot: { x: number; y: number; w: number; h: number }, format: BookFormat, pageIndex: number): boolean {
  const trimW = format.trimWidthIn;
  const trimH = format.trimHeightIn;
  const outer = format.safetyIn;
  const inner = Math.max(format.safetyIn, format.gutterSafetyIn);
  const recto = pageIndex % 2 === 0;
  const left = recto ? inner : outer;
  const right = recto ? outer : inner;
  const x0 = slot.x * trimW;
  const x1 = (slot.x + slot.w) * trimW;
  const y0 = slot.y * trimH;
  const y1 = (slot.y + slot.h) * trimH;
  const t = SAFETY_TOLERANCE_IN;
  return x0 < left - t || x1 > trimW - right + t || y0 < outer - t || y1 > trimH - outer + t;
}

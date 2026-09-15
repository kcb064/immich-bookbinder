import type { Book, BookAsset, BookFormat, Preflight, PreflightItem, RenderData, RenderKind } from '@bookbinder/shared';
import { LuluProduct } from '@bookbinder/shared';
import { coverFrameIn, coverGeometry, coverSlotIn } from './cover.js';
import { effectiveSlots } from './design.js';
import { effectivePpi } from './crop.js';
import { pageSlots } from './design.js';

/** Effective ppi thresholds: below WARN the print looks soft, below ERROR visibly so. */
export const PPI_WARN = 200;
export const PPI_ERROR = 150;

/** The subset of a render row preflight needs. */
export interface PreflightRender {
  kind: RenderKind;
  status: string;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  pageCount?: number | undefined;
  data?: RenderData | undefined;
}

/**
 * Whether a done render still reflects the book: it read the document when it started, so an edit
 * saved while it ran (before it finished) already makes it stale. Compares ISO timestamps as strings.
 */
export function isCurrentRender(render: Pick<PreflightRender, 'status' | 'startedAt' | 'finishedAt'>, updatedAt: string): boolean {
  const madeAt = render.startedAt ?? render.finishedAt;
  return render.status === 'done' && madeAt !== undefined && madeAt >= updatedAt;
}

export interface PreflightInput {
  book: Pick<Book, 'pages' | 'cover' | 'updatedAt'> & Partial<Pick<Book, 'luluProduct'>>;
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
  if (format.vendor === 'lulu' && book.cover) {
    // Cover safety (M7): text and hand-placed photo boxes must sit inside one cover's safe area, clear of the spine and the wrap.
    const g = done('cover')[0]?.data?.cover?.geometry ?? coverGeometry(format, book.luluProduct ?? LuluProduct.parse({}), n);
    for (const { spec, content, adHoc } of effectiveSlots(book.cover.templateId, book.cover.slots)) {
      if (spec.id === 'spine' || spec.role === 'map' || spec.role === 'qr') continue;
      const isPhoto = spec.role === 'hero' || spec.role === 'photo';
      // Resolution of every cover photo, the wrap-around hero included: it spans two trims plus the
      // wrap, so a photo that is fine on an interior page can be half the ppi here.
      if (isPhoto && content?.assetId) {
        const asset = assets.get(content.assetId);
        const box = adHoc || content.frame ? coverFrameIn(spec, format, g) : coverSlotIn(spec, format, g);
        if (asset?.width && asset.height) {
          const ppi = effectivePpi(asset.width, asset.height, box.w, box.h, content.crop);
          if (ppi < PPI_WARN) {
            items.push({
              level: ppi < PPI_ERROR ? 'error' : 'warn',
              code: 'low-resolution',
              message: `${asset.fileName ?? 'The cover photo'} prints at ${Math.round(ppi)} ppi across the cover (${ppi < PPI_ERROR ? 'visibly soft' : 'slightly soft'}; ${PPI_WARN}+ is safe).`,
              slotId: spec.id,
            });
          }
        }
      }
      if (isPhoto && (!adHoc || !content?.assetId)) continue;
      // Text slots with nothing to print are ignored: an ad-hoc box needs text, the back blurb needs a blurb, an emptied slot is hidden.
      if (!isPhoto && ((adHoc && !content?.text) || (spec.id === 'back-blurb' && !content?.text && !book.cover.blurb) || content?.text === '')) continue;
      // Hand-placed frames draw linearly (their own size, no clamping); template slots through the cover map.
      const r = adHoc || content?.frame ? coverFrameIn(spec, format, g) : coverSlotIn(spec, format, g);
      if (!insideCoverSafety(r, format, g)) {
        const what = isPhoto ? 'A photo box' : spec.id === 'title' ? 'The title' : spec.id === 'subtitle' ? 'The subtitle' : spec.id === 'back-blurb' ? 'The back-cover text' : 'A text box';
        items.push({ level: 'warn', code: 'cover-safety', message: `${what} on the cover reaches the ${format.safetyIn} in safety band, the spine or the wrap and may be trimmed or folded.`, slotId: spec.id });
      }
    }
  }
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
      } else if (!isCurrentRender(cover, book.updatedAt)) {
        items.push({ level: 'warn', code: 'cover-stale', message: 'The book changed after the cover PDF was rendered. Render the cover again.' });
      }
    }
  }

  const print = done('print')[0];
  if (!print) items.push({ level: 'warn', code: 'render-missing', message: 'No print PDF has been rendered yet.' });
  else if (!isCurrentRender(print, book.updatedAt)) {
    items.push({ level: 'warn', code: 'render-missing', message: 'The book changed after the last print PDF. Render it again before ordering.' });
  }

  return { ok: !items.some((i) => i.level === 'error'), items };
}

/** Whether a box (inches on the cover sheet) lies inside the back or the front cover's safe area. */
function insideCoverSafety(r: { x: number; y: number; w: number; h: number }, format: BookFormat, g: { wrapIn: number; spineIn: number; frontLeftIn: number }): boolean {
  const t = SAFETY_TOLERANCE_IN;
  const outer = format.safetyIn;
  const inner = Math.max(format.safetyIn, format.gutterSafetyIn);
  const top = g.wrapIn + outer - t;
  const bottom = g.wrapIn + format.trimHeightIn - outer + t;
  const back = { x0: g.wrapIn + outer - t, x1: g.wrapIn + format.trimWidthIn - inner + t };
  const front = { x0: g.frontLeftIn + inner - t, x1: g.frontLeftIn + format.trimWidthIn - outer + t };
  const x0 = r.x;
  const x1 = r.x + r.w;
  const y0 = r.y;
  const y1 = r.y + r.h;
  if (y0 < top || y1 > bottom) return false;
  return (x0 >= back.x0 && x1 <= back.x1) || (x0 >= front.x0 && x1 <= front.x1);
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

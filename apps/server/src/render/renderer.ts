import type { Book, BookAsset, BookFormat, RenderKind, Theme } from '@bookbinder/shared';
import { PT_PER_IN } from '@bookbinder/shared';
import { bookMetaFor, type ImageSrc } from '@bookbinder/pages';
import { renderPrintDocument } from '@bookbinder/pages/print';
import { existsSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { RENDER_PPI, type ImageStore } from './images.js';

/** Fake origin the print HTML references for photos; Playwright intercepts it and serves sharp output. */
export const RENDER_ORIGIN = 'https://render.bookbinder.local';

export interface RenderInput {
  book: Book;
  format: BookFormat;
  theme: Theme;
  assets: ReadonlyMap<string, BookAsset>;
  kind: RenderKind;
  images: ImageStore;
  /** Pages per Chromium document; bounds memory (default 12). */
  batchSize?: number;
  /** Load web fonts from Google Fonts (default true; tests turn it off). */
  webFonts?: boolean;
  onProgress?: (pagesDone: number, pagesTotal: number) => void;
}

export interface RenderOutput {
  pdf: Uint8Array;
  pageCount: number;
  warnings: string[];
}

/**
 * Whether a Chromium build Playwright can launch is installed. `executablePath()` names the full
 * browser, but headless renders use the smaller headless shell, so the only reliable probe is a launch.
 */
export async function chromiumAvailable(): Promise<boolean> {
  try {
    if (existsSync(chromium.executablePath())) return true;
    const b = await chromium.launch({ headless: true, timeout: 30_000 });
    await b.close();
    return true;
  } catch {
    return false;
  }
}

/** Builds the image URL the print HTML uses for a slot; the route handler decodes it. */
function imageSrcFor(kind: RenderKind): ImageSrc {
  const ppi = RENDER_PPI[kind];
  return ({ asset, wIn, hIn, crop }) => {
    const q = new URLSearchParams({ w: String(Math.max(1, Math.round(wIn * ppi))), h: String(Math.max(1, Math.round(hIn * ppi))) });
    if (crop) {
      q.set('fx', crop.focalX.toFixed(4));
      q.set('fy', crop.focalY.toFixed(4));
      q.set('z', crop.zoom.toFixed(3));
    }
    return `${RENDER_ORIGIN}/img/${encodeURIComponent(asset.id)}?${q.toString()}`;
  };
}

/**
 * Renders a book interior to PDF with Playwright's Chromium headless shell. One browser per process,
 * one render at a time (the caller serializes), pages in batches merged with pdf-lib.
 */
export class ChromiumRenderer {
  private browser: Promise<Browser> | undefined;

  private launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium.launch({ headless: true }).then((b) => {
        b.on('disconnected', () => {
          this.browser = undefined;
        });
        return b;
      });
      this.browser.catch(() => {
        this.browser = undefined;
      });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = undefined;
    if (b) await (await b.catch(() => undefined))?.close();
  }

  async render(input: RenderInput): Promise<RenderOutput> {
    const { book, format, theme, assets, kind, images } = input;
    const batchSize = Math.max(1, input.batchSize ?? 12);
    const pages = [...book.pages].sort((a, b) => a.index - b.index);
    const placed = new Set(pages.flatMap((p) => p.slots.map((s) => s.assetId).filter((id): id is string => Boolean(id))));
    const meta = bookMetaFor(book, [...placed].map((id) => assets.get(id)).filter((a): a is BookAsset => a !== undefined), placed.size);
    const imageSrc = imageSrcFor(kind);
    const warnings: string[] = [];
    const warned = new Set<string>();

    const browser = await this.launch();
    const context: BrowserContext = await browser.newContext({ javaScriptEnabled: true });
    try {
      await context.route(`${RENDER_ORIGIN}/**`, async (route) => {
        const url = new URL(route.request().url());
        const m = /^\/img\/([^/]+)$/.exec(url.pathname);
        const asset = m ? assets.get(decodeURIComponent(m[1]!)) : undefined;
        if (!asset) return route.fulfill({ status: 404, body: 'unknown asset' });
        const w = Number(url.searchParams.get('w')) || 1;
        const h = Number(url.searchParams.get('h')) || 1;
        const fx = url.searchParams.get('fx');
        const crop = fx ? { focalX: Number(fx), focalY: Number(url.searchParams.get('fy') ?? 0.5), zoom: Number(url.searchParams.get('z') ?? 1) } : undefined;
        try {
          const body = await images.slotImage(asset, kind, w, h, crop);
          await route.fulfill({ status: 200, contentType: 'image/jpeg', body });
        } catch (err) {
          if (!warned.has(asset.id)) {
            warned.add(asset.id);
            warnings.push(`${asset.fileName ?? asset.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
          await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: placeholderSvg(w, h) });
        }
      });

      const merged = await PDFDocument.create();
      let done = 0;
      input.onProgress?.(0, pages.length);
      for (let start = 0; start < pages.length; start += batchSize) {
        const batch = pages.slice(start, start + batchSize);
        const html = renderPrintDocument({ pages: batch, firstPageIndex: start, format, theme, assets, imageSrc, meta, webFonts: input.webFonts ?? true });
        const page = await context.newPage();
        try {
          await page.emulateMedia({ media: 'print' });
          await page.setContent(html, { waitUntil: 'load', timeout: 120_000 });
          await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]));
          await page.evaluate(() =>
            Promise.all(
              Array.from(document.images).map((img) =>
                img.complete ? img.decode().catch(() => undefined) : new Promise<void>((r) => img.addEventListener('load', () => r(), { once: true })),
              ),
            ),
          );
          const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
          const doc = await PDFDocument.load(pdf);
          const copied = await merged.copyPages(doc, doc.getPageIndices());
          for (const p of copied) merged.addPage(p);
        } finally {
          await page.close();
        }
        done += batch.length;
        input.onProgress?.(done, pages.length);
      }

      merged.setTitle(book.title);
      merged.setProducer('immich-bookbinder');
      merged.setCreator('immich-bookbinder');
      merged.setCreationDate(new Date());
      merged.setModificationDate(new Date());

      const pageCount = merged.getPageCount();
      if (pageCount !== pages.length) warnings.push(`PDF has ${pageCount} pages but the book has ${pages.length}.`);
      const expectW = (format.trimWidthIn + 2 * format.bleedIn) * PT_PER_IN;
      const expectH = (format.trimHeightIn + 2 * format.bleedIn) * PT_PER_IN;
      const first = merged.getPage(0);
      if (first) {
        const { width, height } = first.getSize();
        if (Math.abs(width - expectW) > 1 || Math.abs(height - expectH) > 1) {
          warnings.push(`Page size is ${width.toFixed(1)} × ${height.toFixed(1)} pt, expected ${expectW.toFixed(1)} × ${expectH.toFixed(1)} pt.`);
        }
      }
      const pdf = await merged.save({ useObjectStreams: true });
      return { pdf, pageCount, warnings };
    } finally {
      await context.close();
    }
  }
}

function placeholderSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#d9d2c5"/></svg>`;
}

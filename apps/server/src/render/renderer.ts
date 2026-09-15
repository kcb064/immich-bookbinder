import type { Book, BookAsset, BookCover, BookFormat, CoverGeometry, RenderKind, Theme } from '@bookbinder/shared';
import { PT_PER_IN, PX_PER_IN } from '@bookbinder/shared';
import { pagePx } from '@bookbinder/layout';
import { bookMetaFor, type ImageSrc } from '@bookbinder/pages';
import { renderPrintDocument } from '@bookbinder/pages/print';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium, type Browser, type BrowserContext, type Page as BrowserPage } from 'playwright';
import { RENDER_PPI, type ImageStore } from './images.js';

/** Fake origin the print HTML references for photos; Playwright intercepts it and serves sharp output. */
export const RENDER_ORIGIN = 'https://render.bookbinder.local';

/** Longest edge of a preview PNG, in pixels. */
export const PREVIEW_LONG_EDGE_PX = 1600;

export interface RenderInput {
  book: Book;
  format: BookFormat;
  theme: Theme;
  assets: ReadonlyMap<string, BookAsset>;
  kind: RenderKind;
  images: ImageStore;
  /** The cover to draw: required for `cover` renders, optional for `preview` (adds cover.png). */
  cover?: { cover: BookCover; geometry: CoverGeometry } | undefined;
  /** Pages per Chromium document; bounds memory (default 12). */
  batchSize?: number;
  /** Load web fonts from Google Fonts (default true; tests turn it off). */
  webFonts?: boolean;
  /** Public share link for the colophon's QR code (M7); absent = no QR. */
  shareUrl?: string | undefined;
  onProgress?: (pagesDone: number, pagesTotal: number) => void;
}

export interface RenderOutput {
  pdf: Uint8Array;
  pageCount: number;
  warnings: string[];
}

export interface PreviewOutput {
  pageCount: number;
  hasCover: boolean;
  /** Total bytes written. */
  bytes: number;
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

/** Four-digit page file name for preview PNGs: 0000.png, 0001.png, ... */
export function previewPageFile(index: number): string {
  return `${String(index).padStart(4, '0')}.png`;
}
export const PREVIEW_COVER_FILE = 'cover.png';

/**
 * Renders a book with Playwright's Chromium headless shell: interior and cover PDFs, or page PNGs
 * for the public viewer. One browser per process, one render at a time (the caller serializes),
 * pages in batches (merged with pdf-lib for PDFs).
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

  /**
   * A browser context that answers the print HTML's image requests from the image store. Failures
   * become a placeholder plus one warning per asset, so a broken photo never kills the render.
   */
  private async openContext(input: RenderInput, warnings: string[], deviceScaleFactor = 1): Promise<BrowserContext> {
    const { assets, kind, images } = input;
    const warned = new Set<string>();
    const browser = await this.launch();
    const context = await browser.newContext({ javaScriptEnabled: true, deviceScaleFactor });
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
    return context;
  }

  /** Loads one print document and waits for fonts and every image before handing the page back. */
  private async loadDocument(context: BrowserContext, html: string): Promise<BrowserPage> {
    const page = await context.newPage();
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
    return page;
  }

  private documentFor(input: RenderInput, pages: Book['pages'], firstPageIndex: number, withCover: boolean): string {
    const { book, format, theme, assets, kind } = input;
    const placed = new Set(book.pages.flatMap((p) => p.slots.map((s) => s.assetId).filter((id): id is string => Boolean(id))));
    const meta = bookMetaFor(book, [...placed].map((id) => assets.get(id)).filter((a): a is BookAsset => a !== undefined), placed.size, { shareUrl: input.shareUrl });
    return renderPrintDocument({
      pages,
      firstPageIndex,
      cover: withCover ? input.cover : undefined,
      format,
      theme,
      assets,
      imageSrc: imageSrcFor(kind),
      meta,
      webFonts: input.webFonts ?? true,
    });
  }

  /** Interior (proof, print) or cover PDF. */
  async render(input: RenderInput): Promise<RenderOutput> {
    const { book, format, kind } = input;
    const batchSize = Math.max(1, input.batchSize ?? 12);
    const isCover = kind === 'cover';
    if (isCover && !input.cover) throw new Error('A cover render needs the book cover and its geometry');
    const pages = isCover ? [] : [...book.pages].sort((a, b) => a.index - b.index);
    const warnings: string[] = [];
    const total = isCover ? 1 : pages.length;

    const context = await this.openContext(input, warnings);
    try {
      const merged = await PDFDocument.create();
      let done = 0;
      input.onProgress?.(0, total);
      const batches = isCover ? [[]] : chunk(pages, batchSize);
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b]!;
        const html = this.documentFor(input, batch, b * batchSize, isCover);
        const page = await this.loadDocument(context, html);
        try {
          const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
          const doc = await PDFDocument.load(pdf);
          const copied = await merged.copyPages(doc, doc.getPageIndices());
          for (const p of copied) merged.addPage(p);
        } finally {
          await page.close();
        }
        done += isCover ? 1 : batch.length;
        input.onProgress?.(done, total);
      }

      merged.setTitle(isCover ? `${book.title} (cover)` : book.title);
      merged.setProducer('immich-bookbinder');
      merged.setCreator('immich-bookbinder');
      merged.setCreationDate(new Date());
      merged.setModificationDate(new Date());
      if (isCover && input.cover) merged.setSubject(`Cover spine ${input.cover.geometry.spineIn.toFixed(4)} in (${input.cover.geometry.source}) for ${book.pages.length} pages`);

      const pageCount = merged.getPageCount();
      if (pageCount !== total) warnings.push(`PDF has ${pageCount} pages but expected ${total}.`);
      const expectW = isCover && input.cover ? input.cover.geometry.widthIn * PT_PER_IN : (format.trimWidthIn + 2 * format.bleedIn) * PT_PER_IN;
      const expectH = isCover && input.cover ? input.cover.geometry.heightIn * PT_PER_IN : (format.trimHeightIn + 2 * format.bleedIn) * PT_PER_IN;
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

  /**
   * One PNG per page (`0000.png`, ...) and `cover.png` when a cover is given, written into `outDir`,
   * each with its longest edge at {@link PREVIEW_LONG_EDGE_PX}. Pages are screenshots of the same
   * sheets the proof PDF prints.
   */
  async renderPreviews(input: RenderInput, outDir: string): Promise<PreviewOutput> {
    const { book, format } = input;
    const batchSize = Math.max(1, input.batchSize ?? 12);
    const pages = [...book.pages].sort((a, b) => a.index - b.index);
    const warnings: string[] = [];
    const total = pages.length + (input.cover ? 1 : 0);
    await mkdir(outDir, { recursive: true });
    let bytes = 0;
    let done = 0;
    input.onProgress?.(0, total);

    const px = pagePx(format);
    const pageContext = await this.openContext(input, warnings, PREVIEW_LONG_EDGE_PX / Math.max(px.w, px.h));
    try {
      const batches = chunk(pages, batchSize);
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b]!;
        const page = await this.loadDocument(pageContext, this.documentFor(input, batch, b * batchSize, false));
        try {
          const sheets = page.locator('.bb-sheet');
          for (let i = 0; i < batch.length; i++) {
            const png = await sheets.nth(i).screenshot({ type: 'png', animations: 'disabled' });
            await writeFile(join(outDir, previewPageFile(b * batchSize + i)), png);
            bytes += png.byteLength;
            done++;
            input.onProgress?.(done, total);
          }
        } finally {
          await page.close();
        }
      }
    } finally {
      await pageContext.close();
    }

    let hasCover = false;
    if (input.cover) {
      const g = input.cover.geometry;
      const coverContext = await this.openContext(input, warnings, PREVIEW_LONG_EDGE_PX / Math.max(g.widthIn * PX_PER_IN, g.heightIn * PX_PER_IN));
      try {
        const page = await this.loadDocument(coverContext, this.documentFor(input, [], 0, true));
        try {
          const png = await page.locator('.bb-sheet--cover').screenshot({ type: 'png', animations: 'disabled' });
          await writeFile(join(outDir, PREVIEW_COVER_FILE), png);
          bytes += png.byteLength;
          hasCover = true;
          done++;
          input.onProgress?.(done, total);
        } finally {
          await page.close();
        }
      } finally {
        await coverContext.close();
      }
    }
    return { pageCount: pages.length, hasCover, bytes, warnings };
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function placeholderSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#d9d2c5"/></svg>`;
}

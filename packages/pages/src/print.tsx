/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { renderToStaticMarkup } from 'react-dom/server';
import type { BookAsset, BookCover, BookFormat, CoverGeometry, Page, Theme } from '@bookbinder/shared';
import { NO_FOLIO_TEMPLATE_IDS, pagePx } from '@bookbinder/layout';
import { CoverView } from './CoverView.js';
import { GOOGLE_FONTS_HREF } from './meta.js';
import { PageView, type BookMeta, type ImageSrc } from './PageView.js';

export interface PrintDocumentOptions {
  /** Pages to put in this document, in order (a batch of the book). */
  pages: readonly Page[];
  /** Index in the whole book of `pages[0]`; drives folios and left/right sides. */
  firstPageIndex: number;
  /**
   * A cover sheet (back, spine, front, wrap) placed before the pages. A document with a cover and no
   * pages is the cover PDF: its `@page` takes the cover's size.
   */
  cover?: { cover: BookCover; geometry: CoverGeometry } | undefined;
  format: BookFormat;
  theme: Theme;
  assets: ReadonlyMap<string, BookAsset>;
  imageSrc: ImageSrc;
  meta: BookMeta;
  /** Include the Google Fonts stylesheet link (default true). */
  webFonts?: boolean;
  /** Draw folios on body pages (default true). */
  folios?: boolean;
}

/** Which side page `index` prints on: page 0 is a recto, then verso/recto alternate. */
export function sideOf(index: number): 'left' | 'right' {
  return index % 2 === 0 ? 'right' : 'left';
}

/**
 * A complete HTML document whose every `.bb-sheet` is one PDF page of exactly trim + 2 × bleed,
 * with zero margins, for Chromium's `page.pdf({ preferCSSPageSize: true })`.
 */
export function renderPrintDocument(opts: PrintDocumentOptions): string {
  const { format, theme } = opts;
  const wIn = format.trimWidthIn + 2 * format.bleedIn;
  const hIn = format.trimHeightIn + 2 * format.bleedIn;
  const px = pagePx(format);
  const fonts = opts.webFonts ?? true;
  const cover = opts.cover;
  const pageSize = cover && opts.pages.length === 0 ? { w: cover.geometry.widthIn, h: cover.geometry.heightIn } : { w: wIn, h: hIn };

  const css = `
@page { size: ${pageSize.w}in ${pageSize.h}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bb-sheet { width: ${wIn}in; height: ${hIn}in; overflow: hidden; position: relative; page-break-after: always; break-after: page; }
.bb-sheet--cover { width: ${cover?.geometry.widthIn ?? wIn}in; height: ${cover?.geometry.heightIn ?? hIn}in; }
.bb-sheet:last-child { page-break-after: auto; break-after: auto; }
.bb-page { width: ${px.w}px !important; height: ${px.h}px !important; }
img { image-rendering: auto; }
`;

  const body = renderToStaticMarkup(
    <>
      {cover ? (
        <div className="bb-sheet bb-sheet--cover" data-sheet="cover">
          <CoverView cover={cover.cover} geometry={cover.geometry} format={format} theme={theme} assets={opts.assets} imageSrc={opts.imageSrc} meta={opts.meta} />
        </div>
      ) : null}
      {opts.pages.map((page, i) => {
        const index = opts.firstPageIndex + i;
        const folio = opts.folios === false || NO_FOLIO_TEMPLATE_IDS.has(page.templateId) ? undefined : index + 1;
        return (
          <div className="bb-sheet" key={page.id} data-sheet={index}>
            <PageView page={page} format={format} theme={theme} assets={opts.assets} imageSrc={opts.imageSrc} meta={opts.meta} side={sideOf(index)} folio={folio} />
          </div>
        );
      })}
    </>,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>print</title>
${fonts ? `<link rel="stylesheet" href="${GOOGLE_FONTS_HREF}">` : ''}
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

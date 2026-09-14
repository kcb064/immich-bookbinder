# Print specifications

What the renderer produces and why. Sources: Lulu's print specifications (verified 2026-09-11), Chromium's PDF output behaviour, and the decisions in [design.md](design.md). Presets live in `packages/shared/src/format.ts`.

## Page geometry

All distances are in inches; the layout engine converts to CSS px (96/in) and Chromium emits PDF points (72/in).

| Measure | Value | Meaning |
|---|---|---|
| Trim | per preset, default 8.5 x 8.5 | The finished page size after cutting. |
| Bleed | 0.125 on every side | Backgrounds and full-bleed photos extend this far past the trim so cutting tolerance never leaves a white sliver. PDF page size = trim + 2 x bleed, so **8.75 x 8.75 in (630 x 630 pt)** for the default preset. |
| Safety | 0.5 from the trim | Nothing that matters (faces, text, captions) inside this band; the cut can drift by about 0.125 in and casewrap binding hides more. |
| Gutter safety | 0.375 from the spine | Extra inner margin on every page. Casewrap books do not open flat, so roughly 0.75 in of a spread disappears into the gutter; the panorama template warns about this. |
| Page count | even; casewrap 24 to 800 | The paginator pads with blank or colophon pages to the preset's `pageMultiple` and refuses to render outside `minPages`..`maxPages`. Perfect-bound on coated paper needs 20+. |
| First page | right-hand | Page 1 of the interior PDF is a recto; spreads are (2,3), (4,5), and so on. |

Presets (`FORMAT_PRESETS`): Lulu `0850X0850` 8.5 in square (default), `0750X0750` 7.5 in square, `0850X1100` letter portrait, `1100X0850` letter landscape, `0900X0700` 9x7 landscape, `0827X1169` A4; plus two `home-*` presets (Letter, A4) with zero bleed, 0.4 in margins and no page-count rules, for printing at home.

## Interior PDF

- **One PDF of single pages** (not spreads), each page trim + bleed, **no crop marks, registration marks or colour bars**. Lulu positions the page by its size, so marks would print.
- Every page the same size and orientation.
- Fonts embedded. The print routes load the bundled faces (Newsreader, Source Serif 4, Instrument Sans) through `@font-face`; Chromium subsets and embeds them. No system fonts are relied on.
- Colour: **sRGB**. Chromium cannot write CMYK or PDF/X. Lulu recommends sRGB PDFs and converts to its press profile; do not expect exact matches for saturated reds and blues. No spot colours.
- Images: resized by `sharp` to the slot's exact pixel size at **300 ppi** (never upscaled) and re-encoded as JPEG quality 92 before Chromium sees them, so the PDF grows with page count, not camera resolution. A slot whose source cannot reach **200 ppi** at the printed size shows a warning badge in the editor; below about 150 ppi expect visible softness.
- Transparency is flattened by Chromium; do not rely on blend modes.
- A `pdf-lib` post-pass sets `Title`, `Author` and `Producer` and checks page count and page size. Chromium emits PDF 1.4.

## Cover PDF

- **One page** containing the whole spread: back cover, spine, front cover, plus wrap. Its size comes from Lulu's `POST /cover-dimensions/` for the exact `pod_package_id` and interior page count (spine width depends on paper and page count), requested in `pt`. The app never guesses the spine width.
- Casewrap covers wrap around board, so Lulu's cover spec has a wider wrap than the interior bleed and a 0.75 in safety from the trim on hardcovers. Spine text reads bottom-to-top and is placed only when the spine is at least 0.25 in wide.
- Same font, colour and image rules as the interior.

## Rendering pipeline

1. The server renders the same React page components the editor shows (`packages/pages`) to static HTML with `react-dom/server`: one `.bb-sheet` per page, `@page` set to trim + 2 × bleed with zero margin, `print-color-adjust: exact`. No HTTP print route and no login is involved; the HTML never leaves the process.
2. Photos in that HTML point at a fake origin (`https://render.bookbinder.local/img/<asset>?w=&h=&fx=&fy=`). Playwright intercepts those requests and answers them from `sharp`: the Immich source is cover-fitted around the focal point and resized to exactly the slot's pixel size at the render's ppi, never upscaled.
3. Playwright's Chromium headless shell loads batches of 12 pages, emulates print media, waits for `document.fonts.ready` and every image's `decode()`, then calls `page.pdf` with `preferCSSPageSize`, `printBackground` and zero margins. Batches are merged with `pdf-lib`, which also writes the title and producer and checks the page count and size. One browser, one render at a time, so a NAS never runs two.
4. Two render kinds: **proof** (Immich `preview` thumbnails, 110 ppi, JPEG 80: fast, small, for checking the layout) and **print** (Immich originals, 300 ppi, JPEG 92; originals sharp cannot decode, such as HEIC on most builds, fall back to Immich's `fullsize` JPEG). Sources are cached under `DATA_DIR/cache/immich`. Cover PDFs and per-page PNG previews arrive with M4.
5. Every photo slot in the editor shows its effective pixels per printed inch; below 200 it gets a warning badge, below 150 a red one.

## Checklist before ordering

- Page count even and inside the preset's range (the app enforces this).
- No warning badges left in the editor, or you accept them.
- Cover generated *after* the final page count (the spine width depends on it; the app invalidates the cover when pages change).
- Proof PDF checked at 100% zoom for cropped faces near the safety line.
- Lulu's `/validate-interior/` and `/validate-cover/` pass; the app runs both before creating a print job.

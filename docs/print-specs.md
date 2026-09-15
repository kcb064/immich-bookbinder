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
- Fonts embedded. The print document links the theme faces (Newsreader, Source Serif 4, Manrope) from Google Fonts at render time and Chromium subsets and embeds them, so the server needs outbound HTTPS to `fonts.googleapis.com` and `fonts.gstatic.com` while rendering. When a face does not load the render still finishes but carries the warning *Web fonts could not be loaded*: that PDF was set in the fallback system fonts and should not be sent to print.
- Colour: **sRGB**. Chromium cannot write CMYK or PDF/X. Lulu recommends sRGB PDFs and converts to its press profile; do not expect exact matches for saturated reds and blues. No spot colours.
- Images: resized by `sharp` to the slot's exact pixel size at **300 ppi** (never upscaled) and re-encoded as JPEG quality 92 before Chromium sees them, so the PDF grows with page count, not camera resolution. A slot whose source cannot reach **200 ppi** at the printed size shows a warning badge in the editor; below about 150 ppi expect visible softness.
- Slot geometry is the template's unless the page was designed by hand (M6): a slot content's `frame` (template units, plus rotation and stacking) replaces the template box, and ad-hoc photo and text boxes (`role: 'photo' | 'text'`) draw after the template slots. `pageSlots` in `packages/layout/src/design.ts` resolves this once for the editor, the PDF, the preview PNGs and preflight, so all four agree to the pixel. Rotated photos are rotated as a whole box (CSS transform); a box may reach into the bleed but never sit fully outside it.
- Transparency is flattened by Chromium; do not rely on blend modes.
- A `pdf-lib` post-pass sets `Title`, `Author` and `Producer` and checks page count and page size. Chromium emits PDF 1.4.

## Cover PDF

- **One page** containing the whole sheet: back cover, spine, front cover, plus the wrap on every outer edge. Only Lulu formats get a cover; the `home-*` presets answer 409 to a cover render.
- Geometry comes from `coverGeometry(format, product, pageCount, override?)` in `packages/layout/src/cover.ts`:
  - width = 2 × wrap + 2 × trim width + spine, height = 2 × wrap + trim height; the front cover's trim box starts at `wrap + trimW + spine` from the left edge.
  - **M4 estimate** (`source: 'estimate'`): spine = pages × caliper + board, with caliper 1/444 in (0.002252) for every paper (the trailing `444` of Lulu's paper codes is its pages-per-inch figure), board 0.25 in and wrap 0.75 in for hardcovers (`CW`, `LW`), board 0 and wrap = bleed for soft covers. A 24-page 8.5 in casewrap comes out at 18.80 × 10.00 in with a 0.30 in spine. These numbers are marked `ESTIMATE, verified against Lulu /cover-dimensions/ in M5` in code.
  - **Lulu dimensions** (`source: 'lulu'`, M5): with Lulu credentials saved, every cover and preview render asks `POST /cover-dimensions/` for the exact `pod_package_id` and page count (`unit: 'pt'`). Lulu answers only width and height, so the wrap is derived from the height (`(height - trim height) / 2`) and the spine from the width (`width - 2 x trim width - 2 x wrap`); `coverGeometry(..., override)` in `packages/layout/src/cover.ts` does that. The render records which source sized the sheet in `renders.data`; without credentials the estimate is used and the render warns *Spine width estimated; connect Lulu for exact dimensions*. Preview renders store the geometry their `cover.png` was drawn with, so the viewer crops the front cover with the same numbers.
- The cover template (`cover-editorial`) uses trim-width units: back cover x in [-1, 0], front in [0, 1]; the renderer inserts the spine at 0 and stretches bleed slots to the sheet edge so the hero photo wraps the boards. Text sits on the front over a soft scrim (title, rule, dates), the blurb on the back; spine text reads bottom-to-top and is drawn only when the spine is at least 0.25 in wide.
- The cover is created with the first layout (best-scored placed photo, framed on its faces; title, dates and spine text inherited from the book) and edited on the book page (photo, title, subtitle, spine, back-cover text) or laid out by hand in the editor's cover view (M6): every slot but the spine can be moved, resized and rotated, and text boxes can be added; frames keep the back/front convention, so a box at x < 0 sits on the back cover.
- Same font, colour and image rules as the interior; a pdf-lib post-pass checks that the one page measures the geometry's width × height in points.

## Colophon, QR code and maps (M7)

- Every automatic layout ends with a **colophon** page (`colophon` template, last page, before nothing; padding blanks go before it). It prints the book title, the photograph count, "made with immich-bookbinder" and the date range. When the book has an active share link **and** a public URL is configured, the share URL is encoded as a QR code (byte mode, error correction M, `packages/layout/src/qr.ts`, no dependency) with the URL text next to it. The editor, the viewer PNGs and the print PDF draw the same modules. Remove the page in the editor if you do not want one; a re-layout brings it back.
- Chapter title pages carry an optional **map** (`rules.chapterMaps`, toggled on the review page or the chapter opener panel in the editor): an SVG drawn from the coordinates of the chapter's placed photos, equirectangular around their centre, with a graticule, a chronological route and one dot per distinct spot (`packages/layout/src/map.ts`). No tiles, no network, so the PDF is deterministic; chapters without GPS data draw nothing.
- The title page has a `foreword` text slot (empty unless typed or written by Claude, see [ai.md](ai.md)).

## Page previews (PNG)

- A `preview` render screenshots every `.bb-sheet` of the same print document at a device scale factor that puts the longest edge at **1600 px**, writing `DATA_DIR/exports/<book>/<render>/0000.png`, `0001.png`, ... plus `cover.png` (the whole cover sheet, 1600 px wide) when the book has a cover. Images come from Immich previews at 180 ppi, JPEG 85, so a preview costs about what a proof does.
- The admin UI reads them at `/api/books/:id/renders/:rid/pages/:n.png` and `/cover.png`; the public viewer reads the newest done preview through `/s/:token/pages/:n.png` and `/s/:token/cover.png` and crops the bleed (and, for the cover, the back and spine) in CSS, so viewers see the trimmed book.

## Preflight

`GET /api/books/:id/preflight` runs `preflightBook` (`packages/layout/src/preflight.ts`) and the book page shows the result as "Print readiness". Errors block ordering (M5); warnings are the user's call. Checks, in order:

| Code | Level | Rule |
|---|---|---|
| `page-count` | error | Page count outside `minPages..maxPages` or not a multiple of `pageMultiple`. |
| `empty-slot` | warn | A photo slot with no photo. |
| `low-resolution` | error < 150 ppi, warn < 200 ppi | `effectivePpi` of the source in its printed slot (crop zoom included); a hand-placed frame counts with its own size, and photo boxes added by hand are checked too. Cover photos are graded over the whole sheet they cover (the wrap-around hero spans two trims plus the wrap, so it needs about twice the pixels of an interior page). |
| `caption-safety` | warn | A caption box reaching into the safety band: `safetyIn` from the outer trim edges, `max(safetyIn, gutterSafetyIn)` on the spine side, 0.02 in tolerance. Only captions that would print (user text, or a page with photos) count. |
| `cover-missing` | error (no cover document) / warn (no cover PDF) | Lulu formats only. |
| `cover-stale` | warn | The newest cover PDF was sized for a different page count (spine width), or the book changed after it was rendered. |
| `cover-safety` | warn | Cover text (title, subtitle, back-cover text, text boxes) or a hand-placed photo box that leaves its cover's safe area: `safetyIn` from the outer trim edges, `max(safetyIn, gutterSafetyIn)` towards the spine, nothing across the spine or on the wrap. Uses the geometry of the newest cover render (Lulu's when it had one), else the estimate. |
| `render-missing` | warn | No done print PDF, or the book changed after the last one. Marking a book "rendered" does not count as a change. Creating or revoking the last active share counts (the colophon's QR code appears or goes). |

## Rendering pipeline

1. The server renders the same React page components the editor shows (`packages/pages`) to static HTML with `react-dom/server`: one `.bb-sheet` per page, `@page` set to trim + 2 × bleed with zero margin, `print-color-adjust: exact`. No HTTP print route and no login is involved; the HTML never leaves the process.
2. Photos in that HTML point at a fake origin (`https://render.bookbinder.local/img/<asset>?w=&h=&fx=&fy=`). Playwright intercepts those requests and answers them from `sharp`: the Immich source is cover-fitted around the focal point and resized to exactly the slot's pixel size at the render's ppi, never upscaled.
3. Playwright's Chromium headless shell loads batches of 12 pages, emulates print media, waits for `document.fonts.ready` and every image's `decode()`, then calls `page.pdf` with `preferCSSPageSize`, `printBackground` and zero margins. Batches are merged with `pdf-lib`, which also writes the title and producer and checks the page count and size. One browser, one render at a time, so a NAS never runs two.
4. Renders are kept three per book and kind (newest first); when a new one finishes, older ones are deleted with their files, except a render an unexpired order export still points at. Delete the rest by hand from the book page when you want the disk back sooner.
5. Four render kinds: **proof** (Immich `preview` thumbnails, 110 ppi, JPEG 80: fast, small, for checking the layout), **print** (Immich originals, 300 ppi, JPEG 92; originals sharp cannot decode fall back to Immich's `fullsize` JPEG: sharp's prebuilt libvips has no HEVC decoder, so HEIC originals from iPhones and Samsungs are detected from their metadata and skipped before any decode; anything else that opens but fails to decode is retried on the next variant), **cover** (one sheet from originals at 300 ppi, see below) and **preview** (page PNGs for the web viewer, see below). Sources are cached under `DATA_DIR/cache/immich`.
6. Every photo slot in the editor shows its effective pixels per printed inch; below 200 it gets a warning badge, below 150 a red one.

## Checklist before ordering

- Page count even and inside the preset's range (the app enforces this).
- No warning badges left in the editor, or you accept them.
- Cover generated *after* the final page count (the spine width depends on it; preflight reports `cover-stale` when the page count moved).
- Proof PDF checked at 100% zoom for cropped faces near the safety line.
- Lulu's `/validate-interior/` and `/validate-cover/` pass; the app runs both before quoting a print job (order page), and Lulu also checks the interior page count against the book.

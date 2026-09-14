# immich-bookbinder: working notes for Claude

Read this before touching code. It records what is not obvious from the tree: which commands
actually work on this machine, where the seams are, and which mistakes have already been made once.

## What this is

Self-hosted TypeScript app that turns an Immich library into printed photo books: pick photos,
lay them out on templates, render print PDFs with Chromium, share a viewer, order from Lulu.
Product decisions are settled (see `docs/design.md`, `docs/print-specs.md`, `docs/selection.md`);
do not re-open them. The roadmap is in `README.md`; each remaining milestone has a spec in
`docs/milestones/`. **Start every milestone by reading `docs/milestones/README.md` and the
milestone's own file.**

## Commands (Windows, PowerShell or Git Bash)

`pnpm` is NOT on PATH here. Always prefix with `corepack`:

```sh
corepack pnpm install                       # pnpm 12; native builds are decided in pnpm-workspace.yaml
corepack pnpm check                         # lint + typecheck + test + build: the gate before any commit
corepack pnpm lint                          # eslint only (prettier is NOT part of the gate, see below)
corepack pnpm -r typecheck
corepack pnpm test                          # vitest, all workspaces (~25 s; Chromium tests skip if no browser)
corepack pnpm --filter @bookbinder/web build
corepack pnpm --filter @bookbinder/server exec vitest run src/books/layout.test.ts   # one file
corepack pnpm --filter @bookbinder/server db:generate --name <topic>                # drizzle migration
corepack pnpm --filter @bookbinder/server exec playwright install chromium-headless-shell
corepack pnpm --filter @bookbinder/server exec tsx src/test/fake-immich.ts --port 2290 --photos 90 --home 60
```

Root scripts call `corepack pnpm` internally so they work without pnpm on PATH.
`corepack pnpm check` must be green before every commit; CI runs the same four steps plus a Docker build.

## Running the app locally

- `apps/server/.env` (gitignored) holds `SECRET_KEY`, `ADMIN_PASSWORD=devpassword`, `DATA_DIR=<repo>/.devdata`.
- Preferred flow: build the web app, then start `server` from `.claude/launch.json` (it serves
  `apps/web/dist`, no Vite proxy needed), then start `fake-immich`, then in Settings point the
  Immich URL at `http://127.0.0.1:<fake port>` with any 10+ character key. Log in with `devpassword`.
- Ports 2283/3080/5173 are often held by other sessions; `autoPort` reassigns, read the port from
  the preview result. The Browser pane allows 5 dev servers per folder; if it refuses, run the
  fake Immich as a background Bash task on a spare port instead.
- No real Immich is reachable from a session. The fake (`apps/server/src/test/fake-immich.ts`)
  serves everything the app calls; when you add an Immich endpoint to the client, add it to the fake too.
- Cache gotcha: `DATA_DIR/cache/immich/preview` is keyed by asset id and a fresh fake reuses ids.
  After changing the fake's images, delete that folder and re-run selection with `refetch: true`.
- `book.updatedAt` means "content changed": preflight and the Share card compare render times to it.
  Status-only changes go through `BookStore.setStatus`, which leaves it alone; `save()` always bumps it.
- Browser pane: `file://` is blocked; screenshots time out while the pane is hidden (use
  `get_page_text`/`find`); navigating to a PDF URL opens a save dialog, so rasterise PDFs with a
  scratch pdf.js script instead; `find` matches accessible names (a button's `title`), not labels.

## Conventions that are enforced

- **Verify with tests, not the browser.** Every server feature has an in-process test built on
  `createTestApp()` + `startFakeImmich()` (`apps/server/src/test/helpers.ts`, `fake-immich.ts`).
  `selection.test.ts` and `books/layout.test.ts` show the full flow: settings -> book -> selection
  run -> layout -> render. Chromium tests use `it.skipIf(!hasChromium)`.
- **Schemas first.** Every API body/response is a zod schema in `packages/shared/src/` (`book.ts`,
  `api.ts`); routes parse with `safeParse` and answer `reply.badRequest(zodMessage(err))`. The web
  app parses responses with the same schemas through `get/post/put/del` in `apps/web/src/lib/api.ts`
  and TanStack Query hooks in `apps/web/src/lib/queries.ts`.
- **Book document.** `books.data` holds the whole shared `Book` JSON (pages, chapters, rules,
  luluProduct); only listing columns are denormalised. New per-book state that is not part of the
  document (renders, candidates, shares, orders) gets its own table + drizzle migration
  (`apps/server/drizzle/*.sql` + `meta/`), never an ad-hoc `ALTER`.
- **Shared page rendering.** `packages/pages` `PageView` draws pages for the editor, the viewer and
  the PDF. The renderer turns it into static HTML with `react-dom/server` (`packages/pages/src/print.tsx`)
  and Playwright intercepts `https://render.bookbinder.local/img/...` to serve sharp output. Do
  not add an HTTP print route.
- **Chapters are deterministic.** `planChapters` in `packages/shared/src/chapters.ts` is computed
  identically by the picker, the server layout and the review page. Keep it pure.
- **Folio rule** lives in one place: `NO_FOLIO_TEMPLATE_IDS` in `packages/layout/src/paginate.ts`.
- **Formatting.** The repo is not prettier-clean and never will be mass-formatted. Do not run
  `pnpm format`. Match the surrounding style (single quotes, semicolons, 110 columns) by hand.
- **Dependencies.** Few, and native ones must ship linux/amd64 + arm64 prebuilds (Docker installs
  without a compiler). `better-sqlite3` and `playwright` stay `false` in `allowBuilds`. Playwright is
  pinned to 1.63.0 and `PLAYWRIGHT_VERSION` in `docker/Dockerfile` must match.
- **TSX under `tsx watch`** compiles with the classic JSX runtime unless the file starts with
  `/** @jsxRuntime automatic */ /** @jsxImportSource react */` (see `packages/pages`). Any new
  server-side TSX needs those pragmas.
- **Docs are part of the feature.** A milestone updates the relevant `docs/*.md`, the README
  status line and roadmap row, and `docker/.env.example` / `deploy-dockge.md` if configuration changed.
- **Commits.** One commit per milestone on `main`, subject `Mn <name>: <what landed>`, body listing
  the judgement calls; see `git log` for the pattern. Commit only when asked.

## Map of the code

| Area | Where | Notes |
|---|---|---|
| Config, env | `apps/server/src/config.ts` | zod-validated; `.env` loaded only by `main.ts` |
| App wiring | `apps/server/src/app.ts` | decorates `app.settings`, `app.immichClient()`, `app.selections`, `app.renders`, `app.candidates` |
| Routes | `apps/server/src/routes/*.ts` | `/api/*` behind the session; `/s/*` (viewer: `public.ts`, rate-limited, share cookie `bb_share_<token>`) and `/public/*` (M5 exports, still 404) are the unauthenticated surface; `shares.ts` is the admin side |
| DB | `apps/server/src/db/schema.ts`, `drizzle/` | better-sqlite3 + drizzle, WAL, migrations run at startup |
| Immich | `apps/server/src/immich/` | `client.ts` (openapi-fetch over generated types), `gather.ts` (sources), `trips.ts`, `status.ts` (permission probe) |
| Selection | `apps/server/src/selection/` + `packages/scoring` | analyze (sharp) -> score -> cluster -> pick; candidates cached per photo |
| Layout | `apps/server/src/books/layout.ts` + `packages/layout` | `layoutBook` places picked photos, applies openers and face crops |
| Render | `apps/server/src/render/` | `RenderService` (queue, `renders` table + `data` JSON, kinds proof/print/cover/preview), `ChromiumRenderer` (`render` = PDF, `renderPreviews` = PNG dir), `ImageStore` (sharp, cache) |
| Cover, preflight | `packages/layout/src/cover.ts`, `preflight.ts`; `packages/pages/src/CoverView.tsx` | `coverGeometry` (spine ESTIMATE until M5 passes Lulu's override), `preflightBook` (pure; route in `routes/books.ts`), `CoverView` shared by the book page and the cover PDF; default cover made in `books/layout.ts` |
| Shares | `apps/server/src/shares/store.ts`, `drizzle/0003_*` | `ShareStore` (token, argon2 password, expiry, revoke, views); `ShareView.url` built by `publicBase()` in `routes/shares.ts` |
| Pages | `packages/pages/src/` | `PageView`, `print.tsx`, `meta.ts` (`bookMetaFor`), `spreads.ts` |
| Templates | `packages/layout/src/templates.ts` | page templates + unused spread/cover templates (`cover-editorial`, `map`, `panorama-spread`) |
| Formats | `packages/shared/src/format.ts` | `FORMAT_PRESETS`, `LuluProduct`, `luluPodPackageId` |
| Web | `apps/web/src/pages/*.tsx` | Router in `App.tsx`; `Shell` = sidebar + `RequireAuth`; editor logic is pure in `lib/editor.ts`; `Viewer.tsx` (`/s/:token`) uses plain `fetch`, never `lib/api.ts` (its 401 handler redirects to login); book-page cards live in `components/{Preflight,Share,CoverCard}.tsx` |
| Specs | `specs/` | Vendored Immich 3.2.0 OpenAPI (types generated, gitignored) and Lulu OpenAPI |

Large files that are easy to mis-edit: `NewBook.tsx` (1100 lines), `Review.tsx` (850), `Editor.tsx` (700).
Prefer a new file next to them over growing them; when editing, anchor on a unique multi-line snippet.

## Verified external facts (do not re-research)

- Immich 3.2.0: auth `x-api-key`; album contents via `POST /search/metadata` with `albumIds` and
  cursor paging (`GET /albums/{id}` has no assets); no geo radius in search, geo only through
  `/timeline/buckets` + `/timeline/bucket?bbox=`, `/map/markers`, `/search/places`; face boxes only from `GET /faces?id=`.
- Lulu: dotted `pod_package_id` (`0850X0850.FC.PRE.CW.080CW444.MXX`), casewrap 24 to 800 pages,
  interior = single pages with 0.125 in bleed and no marks, cover = one spread sized by
  `POST /cover-dimensions/`, PDFs fetched by public URL, payment on lulu.com, sandbox needs its own account.
- Chromium PDFs are sRGB PDF 1.4 with subsetted fonts; no CMYK, no PDF/X.

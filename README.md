# immich-bookbinder

Turn an [Immich](https://immich.app) library into printed photo books. immich-bookbinder runs next to your Immich server, picks the photos worth printing, lays them out on real page templates, renders print-ready PDFs with Chromium, publishes a web viewer you can share, and orders hardcover copies through the Lulu Print API. One container, one language (TypeScript), no cloud services except the printer you choose.

> **Status: early development (M1).** You can connect Immich, pick an album, get a chronological automatic layout on the template library, tweak it in the editor (swap, remove, reorder, captions, templates) and download a proof or 300 ppi print PDF. Photo scoring, trips, people, covers, the public viewer and Lulu ordering are still being built milestone by milestone (see the roadmap).

## What it does

- **Sources.** Start a book from an album; from a trip (date range plus a place, detected from Immich's map markers); from people and pets (named faces, or a saved smart-search query for a pet); or from a free-text smart search.
- **Scoring and de-duplication.** Every candidate is scored for sharpness, exposure, faces and (optionally) aesthetics; bursts and near-duplicates collapse to the best frame using Immich's duplicate groups and a perceptual hash. Every in/out decision is explained and reversible.
- **Automatic layout.** Chronological pagination into chapters (by day and place) using a template library in the warm editorial style: off-white paper, serif titles, big place-and-date typography, magazine grids. Swap, crop, caption and reorder afterwards.
- **Print-ready PDFs.** Chromium's print engine produces interior and cover PDFs with bleed, gutter safety, embedded fonts and 300 ppi images, using Lulu format presets (8.5 in square by default, plus letter, A4, 9x7 and 7.5 in square) or a borderless home-print preset.
- **Shareable web viewer.** A tokenised public link shows the finished book as spreads, with optional expiry, password and PDF download. Immich itself is never exposed.
- **Ordering.** Quote, validate and place a hardcover order with Lulu from inside the app; payment stays on lulu.com.

## Quick start (Dockge)

Requirements: Docker with Compose, an Immich server (3.x; the client is generated against 3.2.0), and a way to reach the app from a browser. Ordering from Lulu additionally needs the app reachable from the internet over HTTPS (for example through a Cloudflare Tunnel) so Lulu can download the PDFs.

1. In Dockge, create a new stack called `immich-bookbinder` and paste [`docker/compose.yaml`](docker/compose.yaml).
2. In the stack's `.env` panel, paste [`docker/.env.example`](docker/.env.example). Set `SECRET_KEY` (`openssl rand -hex 32`), `ADMIN_PASSWORD`, `PUBLIC_URL` and `TZ`.
3. Make sure the container can reach Immich. The compose file joins the external network `immich_default`; check yours with `docker network ls` and edit the `name:` if it differs, or delete the `networks:` blocks and use the NAS IP instead.
4. Deploy, then open `http://<nas>:3080` and log in with the admin password.
5. In Immich, create an API key (Account Settings -> API Keys -> New API Key) with the permissions listed in [docs/immich-setup.md](docs/immich-setup.md).
6. In the app's Settings, enter the Immich URL (`http://immich_server:2283` when sharing the network) and the key, then press **Test connection**. It reports the server version, your user, library counts and a per-permission check.

Full instructions, Cloudflare Tunnel and Access notes, backups and updates: [docs/deploy-dockge.md](docs/deploy-dockge.md).

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| D0 design | App UI and book template canvases; decisions in `docs/design.md` | done |
| M0 scaffold | pnpm workspace, Fastify + Vite, SQLite via drizzle, admin login, Immich connection test, Dockerfile, compose, CI, first GHCR image | done |
| M1 album to PDF | Album source, chronological auto-pagination on the template library, page editor (swap, remove, reorder, template, caption, undo), Chromium proof and print PDFs | done |
| M2 selection engine | Scoring, near-duplicate collapse, diversity picking, explainable in/out UI, alternates tray, weight presets | planned |
| M3 trips, people, pets | Date range + geo clustering, trip suggestions, person filters, pet as smart query, face-aware crops, chapter openers | planned |
| M4 print-ready + viewer | Vendor presets, bleed/trim/spine, cover PDF, 300 ppi checks, public token viewer | planned |
| M5 Lulu ordering | Sandbox flow end to end, cost quote, public PDF URLs, order tracking | planned |
| M6 designer | Free-form slots, text boxes, snapping, undo/redo, keyboard navigation | planned |
| M7 optional AI + polish | Claude captions/titles/best-of-burst (opt-in, bring your own key, thumbnails only), themes, map pages, notifications | planned |

## Design

The two Claude Design canvases are the visual spec; decisions and page geometry are recorded in [docs/design.md](docs/design.md).

- App UI (dashboard, new-book wizard, selection review, editor, viewer, order flow): https://claude.ai/code/artifact/e8dfd26e-db6d-4e3f-909b-e51dc6739dc3
- Book templates at real trim size (cover spread, chapter opener, interior templates, both styles): https://claude.ai/code/artifact/7847f459-736f-45be-a2b4-55e1cc246f44

Print geometry and PDF rules: [docs/print-specs.md](docs/print-specs.md). Lulu account and SKU notes: [docs/lulu-setup.md](docs/lulu-setup.md).

## Development

Node 22 or newer. pnpm is pinned in `package.json` and provided by corepack, so `corepack pnpm` works without installing pnpm.

```sh
corepack enable
pnpm install
pnpm generate:immich     # Immich client types from specs/immich-openapi.json (gitignored output)
pnpm dev                 # Fastify on :3080 and Vite dev server in parallel
pnpm lint && pnpm typecheck && pnpm test
pnpm -r build
```

Layout: `apps/server` (Fastify, drizzle/SQLite, render queue, Immich and Lulu clients, Playwright renderer), `apps/web` (React + Vite: admin UI and editor), `packages/shared` (zod schemas and API DTOs), `packages/layout` (templates, pagination, crop math), `packages/pages` (React page components shared by the editor and the PDF renderer), `packages/scoring` (photo scoring and de-duplication), `docker/`, `docs/`, `specs/` (vendored OpenAPI specs).

Rendering needs Playwright's Chromium headless shell. The Docker image installs it; for local development run it once:

```sh
corepack pnpm --filter @bookbinder/server exec playwright install chromium-headless-shell
```

No Immich at hand? A small stand-in with generated photos serves everything the app calls:

```sh
corepack pnpm --filter @bookbinder/server exec tsx src/test/fake-immich.ts --port 2283 --photos 80
```

Then point Settings at `http://127.0.0.1:2283` with any API key of ten or more characters.

Server environment variables (all read at startup):

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | Listen address (image default `3080`, `0.0.0.0`) |
| `DATA_DIR` | SQLite, caches, renders, exports (image default `/data`) |
| `SECRET_KEY` | Encrypts stored credentials and signs sessions; `openssl rand -hex 32` |
| `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` | Admin login; plain text or argon2 PHC string |
| `PUBLIC_URL` | External HTTPS base URL for share links and Lulu PDF downloads |
| `TRUST_CF_ACCESS` | `true` to accept Cloudflare Access identity headers as admin login |
| `LOG_LEVEL` | pino level, default `info` |
| `WEB_DIST` | Built web UI directory (image default `/app/web`) |

Build the image locally with `docker build -f docker/Dockerfile -t immich-bookbinder .`.

## Why not fork immich-book

[ch1bo/immich-book](https://github.com/ch1bo/immich-book) proved the idea (album -> justified layout -> react-pdf) and deserves credit for it. This project needs things that do not fit that codebase: automatic selection and scoring, date/place/people sources, Chromium-based print rendering with bleed and embedded fonts, a shared viewer, ordering, and a container. Its use of Immich's own `@immich/justified-layout-wasm` is carried over for the contact-sheet template.

## License

AGPL-3.0-only. See [LICENSE](LICENSE). Contributions are welcome under the same terms; see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

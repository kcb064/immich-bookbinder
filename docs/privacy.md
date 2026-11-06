# Privacy and data flow

immich-bookbinder runs next to your Immich server and handles your photos. This document is the
authoritative description of what the app stores, where it sends data, and what never leaves the
machine. It is part of the feature set (M8), not an afterthought.

## What the app stores

Everything lives under the single `DATA_DIR` volume (SQLite database + files), nothing else:

- `data/bookbinder.db` — books, selection candidates (scores, hashes, decisions), renders, shares,
  orders, settings. Secrets (Immich API key, Lulu client secrets, optional Anthropic key,
  notification tokens) are encrypted at rest with `SECRET_KEY` (AES-256-GCM, see
  `apps/server/src/crypto.ts`) and are never returned by the API — only a `*Set: true` flag.
- `data/cache/immich/` — decoded previews/originals fetched from Immich for scoring and rendering,
  keyed by asset id. This is the only copy of photo bytes the app keeps; it is deletable at any time
  (the app re-fetches on demand).
- `data/exports/` — rendered PDFs published under a random token for Lulu to download while an
  order is in flight (see below).

Sessions are 32 random bytes, stored server-side in the database, sent as a signed, httpOnly,
SameSite=Lax cookie (`secure: auto` — HTTPS when the request came over HTTPS).

## Where the app sends data (the complete list)

| Destination | What | When | Config |
|---|---|---|---|
| Your Immich server | read-only API calls with your API key (metadata, thumbnails, originals at render time); the URL and key are set by you in Settings | selection, editor, viewer proxy, renders | `Settings -> Immich` |
| Lulu (`api.lulu.com` / `api.sandbox.lulu.com`) | order payloads, PDF URLs, webhook registration; PDFs are fetched by Lulu from the export token URL | only while ordering | `Settings -> Lulu` |
| Your ntfy topic / Gotify server / your webhook URL | notification JSON (book title, status, links) | only when configured | `Settings -> Notifications` |
| Anthropic | thumbnails only, with your own API key, only for the AI features you start | only when enabled | `Settings -> AI` |
| Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) | CSS + font files for the PDF render fonts (Newsreader, Source Serif 4, Manrope) | PDF renders, if enabled | `WEB_FONTS=false` disables this completely |

There is **no telemetry, no analytics, no update check, no "phone home" of any kind**. The only
outbound HTTP calls in the server code are the rows above (grep-verifiable: `apps/server/src` contains
no other hard-coded hosts). The admin UI in the browser additionally loads its own UI font
(Instrument Sans, JetBrains Mono) from Google Fonts via `index.html`; the book display fonts are
only fetched by the PDF renderer.

To run fully offline except for Immich: set `WEB_FONTS=false` and remove the font `<link>`s from
`apps/web/index.html` (or serve behind a network without internet). Renders then use the system
serif/sans fallbacks.

## What the public viewer exposes

- `/s/:token` serves only stored render PNGs/PDF and a `book.json` with title, subtitle, dates and
  page list — never asset ids, never Immich URLs, never the API key. Tokens are 32 random bytes
  (base64url), rate-limited per IP, can expire, can require a password (argon2-hashed, unlock cookie
  bound to the password hash) and can be revoked.
- `/public/exports/:token.pdf` serves print PDFs to Lulu during an order; tokens are random, the
  route is rate-limited and the files are deleted with the order.
- Lulu's webhook receiver verifies the HMAC-SHA256 signature over the raw body before parsing it.

## Security measures

- All `/api/*` routes except `/api/health` and `/api/auth/*` require an authenticated session; the
  check is a single `onRequest` hook (`apps/server/src/auth.ts`).
- Production helmet CSP: `default-src 'self'`, no remote scripts; images only self/data/blob.
- Login and share-unlock are rate-limited; all public routes are rate-limited per IP.
- `TRUST_PROXY` defaults to `true` but is documented: set it to the proxy IP list when the container
  is also reachable directly, so per-IP rate limits cannot be bypassed with forged X-Forwarded-For.
- `TRUST_CF_ACCESS` must stay off unless the app is only reachable through Cloudflare Access.
- All API bodies and responses are validated with zod schemas; path parameters are length-checked
  token regexes where tokens are involved.
- Dependencies are pinned through `pnpm-lock.yaml` with security overrides in
  `pnpm-workspace.yaml`; `pnpm audit` is part of the release checklist (see the M8 commit).

## Reporting

See [SECURITY.md](../SECURITY.md) for how to report a vulnerability privately.

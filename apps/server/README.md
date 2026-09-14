# @bookbinder/server

Fastify 5 API for immich-bookbinder: admin auth, encrypted settings, Immich proxy, books, and static hosting of the built web app. TypeScript, ESM, SQLite (better-sqlite3 + drizzle-orm).

## Scripts

| Script | What it does |
|---|---|
| `pnpm --filter @bookbinder/server dev` | `tsx watch src/main.ts` |
| `pnpm --filter @bookbinder/server build` | regenerates Immich types, then bundles to `dist/main.js` with tsup (workspace packages inlined, node_modules external) |
| `pnpm --filter @bookbinder/server start` | `node dist/main.js` (needs `drizzle/` next to `dist/`) |
| `pnpm --filter @bookbinder/server typecheck` | regenerates Immich types, then `tsc --noEmit` |
| `pnpm --filter @bookbinder/server test` | vitest (no network; Immich is mocked) |
| `pnpm generate:immich` (root) | `openapi-typescript specs/immich-openapi.json` -> `src/immich/generated/immich.d.ts` (gitignored) |
| `pnpm --filter @bookbinder/server db:generate` | drizzle-kit: new migration from `src/db/schema.ts` into `drizzle/` |
| `pnpm --filter @bookbinder/server exec playwright install chromium-headless-shell` | one-time: the browser the PDF renderer launches (the Docker image has it) |
| `pnpm --filter @bookbinder/server exec tsx src/test/fake-immich.ts --port 2283 --photos 80` | a stand-in Immich with generated photos (bursts, blurred frames, two recognised people, a duplicate group) for development without a real server |

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SECRET_KEY` | yes | | >= 32 chars. Signs the session cookie and derives (HKDF) the AES-256-GCM key that encrypts secrets at rest. Changing it invalidates sessions and stored API keys. |
| `ADMIN_PASSWORD` | one of | | Plain admin password, compared in constant time. |
| `ADMIN_PASSWORD_HASH` | one of | | argon2id PHC string (`$argon2id$...`); preferred over the plain password. |
| `PORT` | | `3080` | |
| `HOST` | | `0.0.0.0` | |
| `DATA_DIR` | | `./data` | Holds `bookbinder.sqlite` (WAL), `cache/`, `exports/`. Created on start. |
| `PUBLIC_URL` | | | Absolute external URL for share links and Lulu PDF downloads. The session cookie is `Secure` only on HTTPS requests (`secure: 'auto'`), so plain `http://nas:3080` logins keep working. |
| `LULU_BASE_URL` | | | Development only: base URL of a fake Lulu (`src/test/fake-lulu.ts`) used instead of `api.sandbox.lulu.com` / `api.lulu.com` for both environments. Never set it in production. |
| `TRUST_CF_ACCESS` | | `false` | When `true`, a request carrying `Cf-Access-Authenticated-User-Email` counts as the authenticated admin. Only enable behind Cloudflare Access. |
| `LOG_LEVEL` | | `info` | pino level. |
| `NODE_ENV` | | `development` | `production` enables the CSP and JSON logs; `test` silences logging. |
| `WEB_DIST` | | `../web/dist` (relative to this package) | Built web app; served with an SPA fallback only if `index.html` exists. |

Startup fails with a list of the missing/invalid variables.

## Routes

Everything under `/api` except `/api/health` and `/api/auth/*` requires the `bb_session` cookie (httpOnly, SameSite=Lax, signed) or, with `TRUST_CF_ACCESS`, the Cloudflare header. `/s/*` and `/public/*` are reserved for the public viewer and currently answer 404.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/health` | | `Health` `{status, version, uptimeSeconds}` |
| POST | `/api/auth/login` | `{password}` (5/min/IP) | `{authenticated, via}` + cookie |
| POST | `/api/auth/logout` | | clears cookie |
| GET | `/api/auth/me` | | `{authenticated, via: 'session' \| 'cf-access' \| null}` |
| GET | `/api/settings` | | `SettingsView` (only `*Set` booleans for secrets) |
| PUT | `/api/settings/immich` | `ImmichConnectionInput` `{url, apiKey}` | `SettingsView`; API key stored encrypted |
| DELETE | `/api/settings/immich` | | `SettingsView` |
| PUT | `/api/settings/public-url` | `{publicUrl: string \| null}` | `SettingsView` |
| POST | `/api/immich/test` | optional `{url, apiKey}`; otherwise stored settings | `ImmichStatus` incl. per-permission probes (403 = missing) and a version-mismatch warning in `error` |
| GET | `/api/immich/albums` | | album summaries with `thumbnailUrl` on this origin |
| GET | `/api/immich/people` | | `{total, hidden, people[]}` with `thumbnailUrl` |
| GET | `/api/immich/people/:id/thumbnail` | | image bytes, `Cache-Control: private, max-age=86400` |
| GET | `/api/immich/assets/:id/thumbnail` | `?size=thumbnail\|preview` | image bytes, same caching |
| GET | `/api/books` | | book summaries |
| POST | `/api/books` | `{title, formatId, themeId, subtitle?, rules?, luluProduct?}` | 201 `Book` (status `draft`) |
| GET | `/api/books/:id` | | `Book` |
| PUT | `/api/books/:id` | full `Book` | `Book` (server sets `updatedAt`, keeps `createdAt`) |
| GET | `/api/books/:id/assets` | | `BookAsset[]` gathered for the book, chronological |
| GET | `/api/books/:id/selection` | | `SelectionView` `{candidates, summary?, run?}` (see docs/selection.md) |
| POST | `/api/books/:id/selection/runs` | `{refetch?, rules?}` | 202 `SelectionRun`; 409 without Immich; rules are saved on the book first |
| GET | `/api/books/:id/selection/runs/:rid` | | `SelectionRun` with `phase`, `done`/`total`, `warnings` |
| PUT | `/api/books/:id/selection/decisions` | `{decisions: [{assetId, decision: 'user-in' \| 'user-out' \| 'auto'}]}` | updated `SelectionView`; 409 while a run is active |
| POST | `/api/books/:id/layout` | `{refetch?: boolean}` | `{book, warnings, photoCount}`: gathers the sources from Immich (or reuses the stored list), lays the picked photos (every photo when no selection has run) out on the template library, scores steering hero slots, status `editing`. 409 without Immich, 422 when nothing was found or nothing is picked |
| GET | `/api/books/:id/renders` | | `RenderJob[]`, newest first |
| POST | `/api/books/:id/renders` | `{kind: 'proof' \| 'print'}` | 202 `RenderJob` (queued; poll GET). 409 before the layout exists |
| GET | `/api/books/:id/renders/:rid` | | `RenderJob` with `pagesDone/pagesTotal`, `warnings`, `downloadUrl` when done |
| GET | `/api/books/:id/renders/:rid/pdf` | | the PDF (`Content-Disposition: inline`) |
| DELETE | `/api/books/:id/renders/:rid` | | 204; removes the file. 409 while running |
| DELETE | `/api/books/:id` | | 204 |
| PUT | `/api/settings/lulu` | `{env: 'sandbox' \| 'production', clientKey, clientSecret}` | `SettingsView` (pair stored encrypted per environment) |
| DELETE | `/api/settings/lulu` | `?env=` (default: active) | `SettingsView` |
| PUT | `/api/settings/lulu/sandbox` | `{sandbox: boolean}` | `SettingsView`; picks the active environment |
| POST | `/api/lulu/test` | optional `{env, clientKey, clientSecret}`; otherwise the stored active pair | `LuluStatus` (token + `GET /print-jobs/?page_size=1`); 409 without stored credentials |
| POST | `/api/lulu/reachability` | | `ReachabilityReport`: fetches a throwaway export through the public URL; 409 without one |
| GET | `/api/orders` | | `OrderView[]` across books, newest first |
| GET | `/api/books/:id/orders` | | `OrderView[]` |
| POST | `/api/books/:id/orders` | `PrepareOrderInput` `{quantity?, shippingLevel?, shippingAddress, contactEmail?}` | 202 `OrderView` in `validating`; exports, Lulu validations and the quote run in the background (poll GET). 409 with the reason when Lulu, the public URL, preflight or a current print/cover render is missing |
| GET | `/api/books/:id/orders/:oid` | | `OrderView` |
| POST | `/api/books/:id/orders/:oid/submit` | | `OrderView`: creates the print job (409 unless `quoted`), book status `ordered` |
| POST | `/api/books/:id/orders/:oid/refresh` | | `OrderView` after `GET /print-jobs/{id}/status/` |
| POST | `/api/books/:id/orders/:oid/cancel` | | `OrderView`; through Lulu while unpaid, locally before a job exists, 409 once in production |
| GET | `/public/exports/:token.pdf` | no auth, rate-limited | the print file for Lulu; 404 unknown token, 410 expired |

The Immich API key never leaves the server: browsers only see proxied bytes. Immich requests use `x-api-key` against `${url}/api` (Immich 3.2.0 spec; `GET /server/version` needs no auth).

## Layout

```
src/
  main.ts          entry: load config, build app, listen, graceful shutdown
  app.ts           buildApp(config): plugins, decorators, routes
  config.ts        zod-validated env -> Config
  crypto.ts        SecretBox (AES-256-GCM, HKDF from SECRET_KEY)
  auth.ts          password verify, sessions, cookie, /api guard
  settings.ts      SettingsStore over the settings table
  db/              better-sqlite3 + drizzle, migrations run on startup from ../drizzle
  immich/          openapi-fetch client (client.ts) and connection test (status.ts)
  lulu/            Lulu client (OAuth token cache, typed calls), exports table, order service, reachability probe
  routes/          health, auth, settings, immich, books, shares, lulu (settings + orders), public (viewer + exports), static SPA
  test/            fake-immich.ts and fake-lulu.ts: in-process stand-ins used by the tests and for local development
drizzle/           generated SQL migrations + meta journal (committed)
```

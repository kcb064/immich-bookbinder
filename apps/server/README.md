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

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SECRET_KEY` | yes | | >= 32 chars. Signs the session cookie and derives (HKDF) the AES-256-GCM key that encrypts secrets at rest. Changing it invalidates sessions and stored API keys. |
| `ADMIN_PASSWORD` | one of | | Plain admin password, compared in constant time. |
| `ADMIN_PASSWORD_HASH` | one of | | argon2id PHC string (`$argon2id$...`); preferred over the plain password. |
| `PORT` | | `3080` | |
| `HOST` | | `0.0.0.0` | |
| `DATA_DIR` | | `./data` | Holds `bookbinder.sqlite` (WAL), `cache/`, `exports/`. Created on start. |
| `PUBLIC_URL` | | | Absolute URL the app is reached at. When `https://`, the session cookie is `Secure`. |
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
| DELETE | `/api/books/:id` | | 204 |

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
  routes/          health, auth, settings, immich, books, public placeholder, static SPA
drizzle/           generated SQL migrations + meta journal (committed)
```

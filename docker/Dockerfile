# syntax=docker/dockerfile:1.7
# immich-bookbinder runtime image.
#
# Build context is the repository root, not this directory:
#   docker build -f docker/Dockerfile -t immich-bookbinder .
#
# Stages:
#   base    node + the exact pnpm from package.json "packageManager"
#   deps    pnpm install with only manifests copied (cache survives source edits)
#   build   generate Immich types, build every workspace package, prune server to prod deps
#   runtime slim node + Playwright's Chromium headless shell + server dist + web dist

ARG NODE_IMAGE=node:22-bookworm-slim
# Must equal the "playwright" (or "playwright-core") version apps/server depends on.
# The browser build and the npm package are pinned together; the runtime stage
# checks the installed package against this value and fails the build on mismatch.
ARG PLAYWRIGHT_VERSION=1.63.0

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
WORKDIR /repo
# Corepack reads the pinned pnpm version from package.json "packageManager".
# `corepack install` downloads it once here instead of on the first pnpm call
# of every later layer, and guarantees the image builds with the same pnpm
# that produced pnpm-lock.yaml.
COPY package.json ./
RUN corepack enable && corepack install

# ---------------------------------------------------------------------------
FROM base AS deps
# Only manifests and lockfile: this layer is reused until a dependency changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/layout/package.json packages/layout/
COPY packages/scoring/package.json packages/scoring/
# The pnpm content-addressable store lives in a BuildKit cache mount so repeated
# builds do not re-download packages. Browsers are installed in the runtime
# stage, so skip Playwright's postinstall download here.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ---------------------------------------------------------------------------
FROM deps AS build
# .dockerignore keeps node_modules, dist, docs, design and .env out of the context.
COPY . .
# generate:immich writes apps/server/src/immich/generated/immich.d.ts from the
# vendored spec; it is gitignored, so it must run before typecheck/build.
RUN pnpm generate:immich && pnpm -r build
# `pnpm deploy` writes a self-contained copy of one workspace package with a
# pruned, production-only node_modules. Workspace dependencies
# (@bookbinder/shared etc.) are copied in as real directories, so the result
# runs without the rest of the monorepo. Verified against pnpm 12.4.1: no
# inject-workspace-packages setting is needed.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @bookbinder/server deploy --prod /out/server --store-dir /pnpm/store

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG PLAYWRIGHT_VERSION

LABEL org.opencontainers.image.title="immich-bookbinder" \
      org.opencontainers.image.description="Self-hosted photo books from your Immich library: auto-select, lay out, print-ready PDF, order via Lulu." \
      org.opencontainers.image.source="https://github.com/kcb064/immich-bookbinder" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.url="https://github.com/kcb064/immich-bookbinder"

# Browsers go to a fixed system path instead of ~/.cache so they survive the
# switch to the non-root user below and are found by playwright at runtime.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Chromium headless shell is the build page.pdf() uses; it is far smaller than
# full Chromium and than the 1.9 GB official mcr.microsoft.com/playwright image.
# `--with-deps` runs apt-get update/install for the shared libraries and fonts
# Chromium needs on Debian bookworm, which is why this runs as root. The npx
# cache and apt lists are removed in the same layer to keep it small.
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium-headless-shell \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache /tmp/*

# node images already ship a "node" user with uid/gid 1000. Rename it instead of
# adding a second uid-1000 account, so a bind-mounted ./data on the host ends up
# owned by the usual first user and there is no uid clash.
RUN groupmod -n bookbinder node \
    && usermod -l bookbinder -d /home/bookbinder -m node \
    && mkdir -p /data /app/server /app/web \
    && chown -R bookbinder:bookbinder /data /app

# Server: pruned prod node_modules + rewritten package.json (keeps "type":"module"),
# then the compiled output so /app/server/main.js is the entrypoint.
COPY --from=build --chown=bookbinder:bookbinder /out/server/node_modules /app/server/node_modules
COPY --from=build --chown=bookbinder:bookbinder /out/server/package.json  /app/server/package.json
COPY --from=build --chown=bookbinder:bookbinder /repo/apps/server/dist    /app/server
# drizzle migrations run at startup; the server looks for ./drizzle next to main.js
COPY --from=build --chown=bookbinder:bookbinder /repo/apps/server/drizzle /app/server/drizzle
# Web: static SPA served by Fastify from WEB_DIST.
COPY --from=build --chown=bookbinder:bookbinder /repo/apps/web/dist       /app/web

# Fail the build if the playwright package that ships in node_modules does not
# match the browser build installed above (a silent mismatch shows up only as a
# "browser not found" error at the first render). Tolerates a server that does
# not depend on playwright yet (M0).
RUN PW="${PLAYWRIGHT_VERSION}" node -e ' \
      const fs = require("fs"); \
      const dirs = ["/app/server/node_modules/playwright", "/app/server/node_modules/playwright-core"]; \
      const found = dirs.find((d) => fs.existsSync(d + "/package.json")); \
      if (!found) { console.warn("playwright not in server deps; skipping version check"); process.exit(0); } \
      const v = require(found + "/package.json").version; \
      if (v !== process.env.PW) { \
        console.error(`playwright ${v} in node_modules but browsers installed for ${process.env.PW}; update PLAYWRIGHT_VERSION in docker/Dockerfile`); \
        process.exit(1); \
      } \
      console.log(`playwright ${v} matches installed browsers`);'

ENV NODE_ENV=production \
    PORT=3080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    WEB_DIST=/app/web

EXPOSE 3080
VOLUME ["/data"]

USER bookbinder
WORKDIR /app/server

# curl is not installed; Node 22 has a global fetch. Exit 0 on any 2xx from /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3080) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["node", "/app/server/main.js"]

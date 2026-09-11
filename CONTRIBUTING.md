# Contributing

Thanks for looking. This is a small project in early development; the [README roadmap](README.md#roadmap) says what is being built next, and the design decisions are in [docs/design.md](docs/design.md).

## Before you start

- Open an issue for anything bigger than a bug fix or a doc correction so the approach can be agreed first. Features that need a new Immich permission, a new external service, or a change to the book/page schema in `packages/shared` should always start as an issue.
- Check the roadmap: a milestone marked "planned" may already be in progress on a branch.

## Setup

Node 22 or newer, then:

```sh
corepack enable
pnpm install
pnpm generate:immich
pnpm dev
```

`pnpm lint`, `pnpm typecheck` and `pnpm test` must pass; CI runs exactly those plus `pnpm -r build` and a Docker build. Formatting is Prettier (`pnpm format`, settings in `.prettierrc`).

## Pull requests

- One topic per PR, with a short description of what changed and how you tested it (against a real Immich if the Immich client is involved; in the Lulu sandbox if ordering is involved).
- Add or update a test where there is logic to test. `packages/*` are pure TypeScript and easy to unit test; the renderer has Playwright e2e tests.
- Keep dependencies few. Native modules (`sharp`, `better-sqlite3`, `onnxruntime-node`, Playwright) must keep shipping prebuilt binaries for linux/amd64 and linux/arm64, because the Docker image installs them without a compiler.
- If you bump Playwright, change `PLAYWRIGHT_VERSION` in `docker/Dockerfile` too; the image build fails on a mismatch.
- If you update `specs/immich-openapi.json`, also bump `SUPPORTED_IMMICH_VERSION` in `packages/shared/src/api.ts` and say which Immich version you tested against.

## Licence

By contributing you agree that your contribution is licensed under AGPL-3.0-only, the same as the project.

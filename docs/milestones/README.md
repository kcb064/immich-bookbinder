# Milestone specs

One file per remaining roadmap milestone. Each spec is written so a single session can deliver the
milestone without re-deriving the design: what exists to build on, what to build, the judgement
calls already made, what is out of scope, and how to prove it works.

| File | Milestone | Depends on |
|---|---|---|
| [M4.md](M4.md) | Print-ready output and public viewer | M3 (done) |
| [M5.md](M5.md) | Lulu ordering | M4 (cover PDF, public exports) |
| [M6.md](M6.md) | Free-form designer | M4 (viewer shows the same pages) |
| [M7.md](M7.md) | Optional AI, pets, maps, polish | M4, M5 |

## How a milestone session runs

1. Read `CLAUDE.md` at the repo root, then the milestone file. Do not skim the "Existing seams"
   section: it lists the functions, tables and templates that already exist so nothing is rebuilt.
2. Confirm the baseline is green before changing anything: `corepack pnpm check`.
3. Build in this order, committing nothing until the end: shared schemas (`packages/shared`) ->
   pure packages (`packages/*`) with unit tests -> server (tables, services, routes) with
   in-process tests against the fake Immich -> web UI -> docs.
4. Work through the acceptance criteria as a checklist; each one maps to at least one test or a
   concrete manual check listed under "Verification".
5. Run `corepack pnpm check` again, then the manual flow against the fake Immich if the milestone
   touches the UI. Fix, do not skip, anything red.
6. Update docs: the files named in the spec, the README status paragraph, the roadmap row
   (`planned` -> `done`), and `docker/.env.example` + `docs/deploy-dockge.md` if configuration changed.
7. One commit on `main`: `Mn <name>: <what landed>`, body listing the judgement calls made without
   Kevin. Push only when asked.
8. Save a memory note (the project memory directory is shared across sessions) with the non-obvious
   choices, in the same shape as the M2/M3 notes.

## Definition of done

- Every acceptance criterion in the spec is met or explicitly reported as deferred with a reason.
- `corepack pnpm check` is green; new logic has tests; no test was weakened to pass.
- The fake Immich still serves every endpoint the client calls (extend it when the client grows).
- Docs updated as above. The spec file itself gets a short "Delivered" section at the bottom
  listing deviations from the plan.

## Writing style for these specs

Plain statements, one decision per bullet, file paths for everything that already exists. When
a value is an estimate that must be verified later (a spine width, a Lulu limit), say so in the
spec and in the code comment.

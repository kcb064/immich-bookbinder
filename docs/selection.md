# Selection engine

How immich-bookbinder decides which photos go in a book (milestone M2). Code: `packages/scoring` (pure TypeScript, unit-tested on synthetic images), `apps/server/src/selection` (jobs, sharp decoding, Immich calls), `apps/web/src/pages/Review.tsx` (the review page).

## Pipeline

A selection run has four phases; the review page shows which one is active.

1. **Gather.** The book's sources are fetched from Immich (`POST /search/metadata` with `withExif`, `withPeople`, `withStacked`). Videos, trashed and archived assets and non-primary stack members are dropped. The cached subset per photo (`BookAsset`) now includes named people, the EXIF rating and Immich's `duplicateId`.
2. **Analyse.** Every photo's `preview` (up to 1440 px, the same file the proof render uses) is downloaded once into `DATA_DIR/cache`, reduced to 512 px and measured. Originals are never fetched for scoring. Analysis is cached per photo, so re-runs after changing weights take well under a second for a thousand photos.
3. **Faces.** For a shortlist (the strongest 2 x target, at least 60) of photos that show recognised people, `GET /faces?id=` supplies bounding boxes, stored as fractions of the frame. They refine the people score and will drive face-aware crops in M3. Without `face.read` the run continues and warns; people still count by name.
4. **Pick.** Scores, near-duplicate clusters and the diversity picker (all in `packages/scoring`) produce a `Candidate` per photo with a decision and the reasons behind it.

## Metrics and scores

Measured on the 512 px greyscale/RGB preview:

| Metric | What it is |
|---|---|
| `laplacianVar` | Variance of a 3x3 Laplacian. Blur removes high frequencies, so blurry photos sit near zero; crisp ones in the hundreds. |
| `meanLuma`, `stdevLuma`, `clipDark`, `clipBright` | Histogram statistics: brightness, contrast, and the fractions of pixels below 8 or above 247. |
| `colorfulness` | Hasler and Suesstrunk (2003) opponent-colour statistic. |
| `thirds` | Share of gradient energy inside four windows on the rule-of-thirds points (uniform texture gives about 0.25). |
| `phash` | 64-bit DCT perceptual hash of the 32x32 downsample. |

Scores, all 0..1 (the UI shows them x10):

- **sharpness** = log-scaled Laplacian variance (about 10 -> 0, 100 -> 0.5, 1000 -> 1).
- **exposure** penalises a mean far from mid-grey, clipped highlights/shadows and flat contrast.
- **aesthetic** is a deliberately simple, explainable proxy: 35% colourfulness, 25% tonal range, 20% clean highlights/shadows, 20% thirds energy. A learned aesthetic model (NIMA-style ONNX) is not part of M2; it can slot in behind the same weight later.
- **people** is 0.45 when nobody is in the shot (neutral, so scenery is not punished), 0.6 for unnamed faces, 0.75 for named people, 0.9 for a featured person, adjusted by the largest face's size and centrality and reduced for faces cut off by the frame.
- **composite** = weighted mean of technical (65% sharpness + 35% exposure), people and aesthetic using the book's weights, plus +0.08 for an Immich favourite and +/-0.02 per star away from 3. This is what the picker ranks by.

A photo is **blurry** when its sharpness score is below 0.25 *and* its Laplacian variance is below 20% of the book's median, so a deliberately soft series (fog, long exposures) is not wiped out.

## Near-duplicates

Immich duplicate groups (`duplicateId`) always cluster. Otherwise photos are compared with the previous 12 in time order: a Hamming distance of at most 5 bits is the same picture whatever the timestamps say; at most 12 bits within 90 seconds is a burst. The best member wins (your own keep first, then favourites, then not blurry, then composite score); the others become **alternates** with the reason "near-duplicate of a better shot" and a link to the winner. "Use instead" on an alternate keeps it and drops the winner.

## Picking

Target count = about 2.8 photos per body page (`targetPhotosFor(targetPages)`; 48 pages -> 129). The picker takes, in order:

1. photos you kept (`user-in`), then favourites (when "Favourites always in" is on);
2. a greedy pass: each round picks the eligible photo with the highest `score - variety x penalty`, where the penalty grows with how many photos its day (relative to a sqrt-proportional day quota), its hour and its place already have. Variety 0 is a plain top-N by score; the default 0.8 spreads a trip across its days without letting a 30-photo day outvote a 300-photo day;
3. a guarantee that every featured person appears at least once, swapping out the weakest plain pick if needed.

Burst losers and blurry photos are never picked automatically; photos you removed (`user-out`) never are either.

Every candidate carries reasons (`Reason.kind`): `top-score`, `favorite`, `best-of-burst`, `featured-person`, `user-in`, `user-out`, `duplicate`, `blurry`, `variety`, `below-cut`, `no-analysis`. The review page shows them under "Why it is in / out".

## Presets and weights

`ScoringWeights` has four sliders: sharpness, people, aesthetic, variety. Presets (`WEIGHT_PRESETS`): Balanced (the defaults), People first, Landscapes, Best quality. Changing a slider or a rule toggle on the review page saves the book's rules and re-runs the picker from cached analysis; your keeps and removals survive every re-run.

## Layout

`POST /api/books/:id/layout` places only the picked photos (chronologically) once a selection exists; without one it places everything, as in M1. Composite scores steer higher-scored photos to hero slots within a page (`assignPhotos` in `packages/layout`), without changing which template is chosen.

## API

| Route | Purpose |
|---|---|
| `GET /api/books/:id/selection` | `{ candidates, summary?, run? }`, candidates in chronological order |
| `POST /api/books/:id/selection/runs` | Queue a run; body `{ refetch?, rules? }`; 202 with the run |
| `GET /api/books/:id/selection/runs/:rid` | Poll a run (`phase`, `done`/`total`, `warnings`, `error`) |
| `PUT /api/books/:id/selection/decisions` | `{ decisions: [{ assetId, decision: 'user-in' | 'user-out' | 'auto' }] }`; returns the updated view |

Runs are serial per server (one queue, like renders). Preview decoding uses `cores - 1` workers, at most 4; override with `buildApp(config, { selection: { concurrency } })` in tests.

## Privacy and cost

Scoring reads Immich previews only (never originals) and keeps them in the local cache the proof renderer already uses. No image leaves the container. A 1,000-photo album costs roughly 1,000 preview downloads (~250 MB over the LAN) and a few minutes of CPU on the first run; later runs reuse the analysis.

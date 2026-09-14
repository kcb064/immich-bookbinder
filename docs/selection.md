# Selection engine

How immich-bookbinder decides which photos go in a book and how the book is split into chapters (milestones M2 and M3). Code: `packages/scoring` (pure TypeScript, unit-tested on synthetic images), `packages/shared/src/chapters.ts` (chapter planning, shared by the picker, the paginator and the review page), `apps/server/src/selection` (jobs, sharp decoding, Immich calls), `apps/server/src/immich` (gathering and trip detection), `apps/web/src/pages/Review.tsx` (the review page).

## Sources

A book's rules name one or more sources; their photos are unioned, de-duplicated by id and sorted by capture time. All of them go through `POST /search/metadata` with `withExif`, `withPeople`, `withStacked` and 3.2's cursor paging, except smart search. Videos, trashed and archived assets and non-primary stack members are dropped. The cached subset per photo (`BookAsset`) holds dates, dimensions, city/region/country, GPS position, named people, the EXIF rating, Immich's `duplicateId` and the description.

| Source      | How it is gathered                                                                                                                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `album`     | `albumIds` in the metadata search (Immich 3.2 dropped `assets[]` from `GET /albums/:id`).                                                                                                                                                                                                                                                                      |
| `trip`      | `takenAfter`/`takenBefore` in the metadata search, then each photo's EXIF coordinates are checked against the trip's places (`[west, south, east, north]` boxes). Photos without GPS stay in when `includeUngeotagged` is on (the default: cameras without GPS shot the same holiday). Photos in the range but outside every place are dropped with a warning. |
| `people`    | One metadata search per person (`personIds` in Immich means _all_ of them; a person book wants _any_), unioned.                                                                                                                                                                                                                                                |
| `smart`     | `POST /search/smart` with the query (CLIP) and `limit` (default 200, at most 1000) best matches. A warning notes when the limit was hit. Smart results carry EXIF but no people list.                                                                                                                                                                          |
| `favorites` | `isFavorite` in the metadata search.                                                                                                                                                                                                                                                                                                                           |

### Trip suggestions

`GET /api/immich/trips?from&to` (default: the last two years) reads every geotagged, non-trashed photo in the range through `GET /timeline/buckets` + `GET /timeline/bucket` with `withCoordinates` (one small columnar request per month, no per-asset calls), then:

1. clusters positions at 30 km and calls the cluster seen on the most distinct days **home**;
2. marks a calendar day (in the photo's local time) **away** when at least 60% of its photos are more than 60 km from home;
3. joins consecutive away days into a trip, bridging up to two photo-less days but never a day back home; a trip needs two away days, or a single day with at least 30 photos;
4. groups a trip's photos into **places** at 25 km, named by the most common city (else country), each with a padded bounding box, and titles the trip "Lisbon, Sintra & Porto".

The wizard turns a suggestion into a `trip` source (dates plus places) and a title; dates and places can also be typed, with `GET /search/places` supplying the place picker (a box of about 25 km around the hit). Results are cached per range for ten minutes. Trip photos without GPS are not counted in the suggestion but are gathered.

## Pipeline

A selection run has four phases; the review page shows which one is active.

1. **Gather.** The sources above.
2. **Analyse.** Every photo's `preview` (up to 1440 px, the same file the proof render uses) is downloaded once into `DATA_DIR/cache`, reduced to 512 px and measured. Originals are never fetched for scoring. Analysis is cached per photo, so re-runs after changing weights take well under a second for a thousand photos.
3. **Faces.** For a shortlist (the strongest 2 x target, at least 60) of photos that show recognised people, `GET /faces?id=` supplies bounding boxes, stored as fractions of the frame. They refine the people score and set the crop focal point at layout. Without `face.read` the run continues and warns; people still count by name.
4. **Pick.** Chapters are planned, then scores, near-duplicate clusters and the diversity picker (all in `packages/scoring`) produce a `Candidate` per photo with a decision, its chapter and the reasons behind it.

## Metrics and scores

Measured on the 512 px greyscale/RGB preview:

| Metric                                            | What it is                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `laplacianVar`                                    | Variance of a 3x3 Laplacian. Blur removes high frequencies, so blurry photos sit near zero; crisp ones in the hundreds. |
| `meanLuma`, `stdevLuma`, `clipDark`, `clipBright` | Histogram statistics: brightness, contrast, and the fractions of pixels below 8 or above 247.                           |
| `colorfulness`                                    | Hasler and Suesstrunk (2003) opponent-colour statistic.                                                                 |
| `thirds`                                          | Share of gradient energy inside four windows on the rule-of-thirds points (uniform texture gives about 0.25).           |
| `phash`                                           | 64-bit DCT perceptual hash of the 32x32 downsample.                                                                     |

Scores, all 0..1 (the UI shows them x10):

- **sharpness** = log-scaled Laplacian variance (about 10 -> 0, 100 -> 0.5, 1000 -> 1).
- **exposure** penalises a mean far from mid-grey, clipped highlights/shadows and flat contrast.
- **aesthetic** is a deliberately simple, explainable proxy: 35% colourfulness, 25% tonal range, 20% clean highlights/shadows, 20% thirds energy. A learned aesthetic model (NIMA-style ONNX) is not part of this; it can slot in behind the same weight later.
- **people** is 0.45 when nobody is in the shot (neutral, so scenery is not punished), 0.6 for unnamed faces, 0.75 for named people, 0.9 for a featured person, adjusted by the largest face's size and centrality and reduced for faces cut off by the frame.
- **composite** = weighted mean of technical (65% sharpness + 35% exposure), people and aesthetic using the book's weights, plus +0.08 for an Immich favourite and +/-0.02 per star away from 3. This is what the picker ranks by.

A photo is **blurry** when its sharpness score is below 0.25 _and_ its Laplacian variance is below 20% of the book's median, so a deliberately soft series (fog, long exposures) is not wiped out.

## Near-duplicates

Immich duplicate groups (`duplicateId`) always cluster. Otherwise photos are compared with the previous 12 in time order: a Hamming distance of at most 5 bits is the same picture whatever the timestamps say; at most 12 bits within 90 seconds is a burst. The best member wins (your own keep first, then favourites, then not blurry, then composite score); the others become **alternates** with the reason "near-duplicate of a better shot" and a link to the winner. "Use instead" on an alternate keeps it and drops the winner.

## Chapters

`planChapters` (`packages/shared`) is pure and deterministic, so the picker, the paginator and the review page always agree. The rule `chapters` selects the mode:

- **auto / places** (default): each photo gets a place key: city, else region (`state`), else a GPS cluster (40 km) named after the nearest city seen in the book within 80 km (else "Somewhere in <country>", else rounded coordinates), else country. Maximal chronological runs of one key become chapters. Runs shorter than 3% of the book (at least 3 photos) merge into a neighbour (preferring one with the same place, so a two-hour detour vanishes into its day), and the count is capped at one chapter per 8 target pages (at most 12) by merging the smallest runs. A book that is one place from start to end gets no chapters.
- **days**: runs of calendar days, merged the same way; titled "Day 3" / "Days 3–4", subtitled with the date and the dominant place.
- **none**: no chapters.

Books with fewer than 6 photos never get chapters. A chapter's subtitle is its date range ("May 12 – 14, 2026") plus the country when the book spans several countries.

### Budgets

Each chapter costs an opener spread, so the photo target shrinks: `targetPhotosFor(targetPages, chapters)` = 2.8 photos per remaining body page plus one hero per chapter. The picker treats chapters like days: a sqrt-proportional quota per chapter (a 1,200-photo Lisbon still outweighs a 40-photo Sintra, but not 30 to 1), a penalty that rises steeply past the quota, and a guarantee of at least two picks per chapter (the opener hero and one more) by swapping out the weakest plain pick from the most over-budget chapter. That is how a 3,600-photo trip lands on 48 pages with every place present. Reasons show it: "Scored 8.1, but Lisbon already has 34 of about 30 highlights; kept for variety" and "Best of Sintra, kept so the chapter has its opener" (`chapter`).

## Picking

Target count = about 2.8 photos per body page (48 pages -> 129 without chapters, 101 with six). The picker takes, in order:

1. photos you kept (`user-in`), then favourites (when "Favourites always in" is on);
2. a greedy pass: each round picks the eligible photo with the highest `score - variety x penalty`, where the penalty grows with how many photos its day (relative to a sqrt-proportional day quota), its chapter (same shape) and its hour already have. Variety 0 is a plain top-N by score; the default 0.8 spreads a trip across its days and places without letting a 30-photo day outvote a 300-photo day;
3. the chapter guarantee above;
4. a guarantee that every featured person appears at least once, swapping out the weakest plain pick if needed.

Burst losers and blurry photos are never picked automatically; photos you removed (`user-out`) never are either.

Every candidate carries reasons (`Reason.kind`): `top-score`, `favorite`, `best-of-burst`, `featured-person`, `chapter`, `user-in`, `user-out`, `duplicate`, `blurry`, `variety`, `below-cut`, `no-analysis`. The review page shows them under "Why it is in / out".

## Presets, weights and people

`ScoringWeights` has four sliders: sharpness, people, aesthetic, variety. Presets (`WEIGHT_PRESETS`): Balanced (the defaults), People first, Landscapes, Best quality. Changing a slider, a rule toggle or the chapter mode on the review page saves the book's rules and re-runs the picker from cached analysis; your keeps and removals survive every re-run.

The review page lists every named person seen in the gathered photos with picked/total counts; clicking one filters the grid, and the star marks the person as **featured** (`featuredPersonIds`): featured people score 0.9 on the people axis and are guaranteed at least one appearance. A book created from the People source features its people by default. Chapters can be shown as groups or used as a filter, and the grid can be grouped by chapter or by day.

## Layout

`POST /api/books/:id/layout` places only the picked photos (chronologically) once a selection exists; without one it places everything, as in M1. The chapter plan is recomputed from every gathered photo (so it matches the picker's), picked photos keep their chapter, and each chapter with photos opens on a spread: a full-bleed hero (the chapter's best-scored photo whose shape suits the page) on the verso, then the title page with place, date range, a rule and the photo count on the recto, aligned with a blank when needed. Composite scores steer higher-scored photos to hero slots within a page (`assignPhotos` in `packages/layout`), without changing which template is chosen. Opener pages carry no folio and keep their template in the editor; their title and subtitle can be typed over per book.

### Face-aware crops

Every slot cover-fits its photo (CSS `object-fit: cover`), so a 3:2 photo in a square slot loses a third of its width. `applyFaceCrops` sets the focal point of every placed photo that has face boxes: the union of the faces (padded by 35% of their size for hair and chins) is centred in the visible window, clamped to the image, and stored as `Crop.focalX/Y` in fractions, which both the editor (`object-position`) and the print renderer (sharp extract) honour. Photos whose slot shows the whole frame, and photos without faces, keep the centred default. The editor shows "Framed on the faces" with a Centre button to undo it.

## API

| Route                                    | Purpose                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/books/:id/selection`           | `{ candidates, summary?, run?, chapters }`, candidates in chronological order, chapters with picked/total |
| `POST /api/books/:id/selection/runs`     | Queue a run; body `{ refetch?, rules? }`; 202 with the run                                                |
| `GET /api/books/:id/selection/runs/:rid` | Poll a run (`phase`, `done`/`total`, `warnings`, `error`)                                                 |
| `PUT /api/books/:id/selection/decisions` | `{ decisions: [{ assetId, decision: 'user-in' \| 'user-out' \| 'auto' }] }`; returns the updated view     |
| `GET /api/immich/trips?from&to`          | Trip suggestions for a YYYY-MM-DD range                                                                   |
| `GET /api/immich/places?name=`           | Gazetteer hits for the place picker                                                                       |
| `GET /api/immich/smart?q=&size=`         | A preview of a smart-search query                                                                         |

Runs are serial per server (one queue, like renders). Preview decoding uses `cores - 1` workers, at most 4; override with `buildApp(config, { selection: { concurrency } })` in tests.

## Privacy and cost

Scoring reads Immich previews only (never originals) and keeps them in the local cache the proof renderer already uses. No image leaves the container. A 1,000-photo album costs roughly 1,000 preview downloads (~250 MB over the LAN) and a few minutes of CPU on the first run; later runs reuse the analysis. Trip detection costs one small request per month scanned.

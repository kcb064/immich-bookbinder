import { z } from 'zod';
import { ChapterMode } from './chapters.js';
import { LuluProduct } from './format.js';

export const Id = z.string().min(1);

/** WGS84 bounding box: [west, south, east, north] in degrees. */
export const BBox = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type BBox = z.infer<typeof BBox>;

/** A named area a trip covers; photos with coordinates inside the box belong to the trip. */
export const TripPlace = z.object({ name: z.string().min(1), bbox: BBox });
export type TripPlace = z.infer<typeof TripPlace>;

/** Which photos feed a book. Several sources are unioned, then filters apply. */
export const SelectionSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('album'), albumIds: z.array(Id).min(1) }),
  z.object({
    kind: z.literal('trip'),
    takenAfter: z.iso.datetime(),
    takenBefore: z.iso.datetime(),
    /** Places the trip visited; empty = anywhere in the date range. */
    places: z.array(TripPlace).default([]),
    /** Keep photos in the date range that carry no GPS data (cameras without GPS). */
    includeUngeotagged: z.boolean().default(true),
  }),
  /** Every photo showing any of these people (union). */
  z.object({ kind: z.literal('people'), personIds: z.array(Id).min(1) }),
  /** CLIP smart search: the `limit` best matches for the text (or the example photo). */
  z.object({ kind: z.literal('smart'), query: z.string().min(1), queryAssetId: Id.optional(), limit: z.number().int().min(10).max(1000).default(200) }),
  z.object({ kind: z.literal('favorites') }),
]);
export type SelectionSource = z.infer<typeof SelectionSource>;

export const ScoringWeights = z.object({
  /** Technical quality: Laplacian sharpness (65%) and exposure (35%). */
  sharpness: z.number().min(0).max(1).default(0.7),
  /** Faces and named people; featured people count most. */
  people: z.number().min(0).max(1).default(0.6),
  /** Heuristic aesthetic proxy: colourfulness, tonal range, clipping, rule-of-thirds energy. */
  aesthetic: z.number().min(0).max(1).default(0.45),
  /** How hard the picker spreads across days, hours and places (0 = pure top-N by score). */
  variety: z.number().min(0).max(1).default(0.8),
});
export type ScoringWeights = z.infer<typeof ScoringWeights>;

export interface WeightPreset {
  id: string;
  name: string;
  description: string;
  weights: ScoringWeights;
}

/** Named weight sets for the review page. "balanced" equals the schema defaults. */
export const WEIGHT_PRESETS: readonly WeightPreset[] = [
  { id: 'balanced', name: 'Balanced', description: 'Sharp, well-lit photos with people and places evenly represented.', weights: ScoringWeights.parse({}) },
  { id: 'people-first', name: 'People first', description: 'Faces win. Every featured person shows up; scenery fills the gaps.', weights: { sharpness: 0.6, people: 1, aesthetic: 0.35, variety: 0.7 } },
  { id: 'landscapes', name: 'Landscapes', description: 'Places over faces: colour, light and composition lead.', weights: { sharpness: 0.8, people: 0.15, aesthetic: 0.85, variety: 0.9 } },
  { id: 'best-quality', name: 'Best quality', description: 'Top scores only, even if one afternoon dominates.', weights: { sharpness: 1, people: 0.5, aesthetic: 0.7, variety: 0.25 } },
];

/** The preset whose weights equal `weights` (within slider precision), or undefined for custom weights. */
export function presetFor(weights: ScoringWeights): WeightPreset | undefined {
  const eq = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;
  return WEIGHT_PRESETS.find(
    (p) => eq(p.weights.sharpness, weights.sharpness) && eq(p.weights.people, weights.people) && eq(p.weights.aesthetic, weights.aesthetic) && eq(p.weights.variety, weights.variety),
  );
}

export const SelectionRules = z.object({
  sources: z.array(SelectionSource).min(1),
  /** People who must appear at least once and get a scoring boost. */
  featuredPersonIds: z.array(Id).default([]),
  includeFavoritesAlways: z.boolean().default(true),
  collapseNearDuplicates: z.boolean().default(true),
  skipBlurry: z.boolean().default(true),
  spreadAcrossDays: z.boolean().default(true),
  includeVideoStills: z.boolean().default(false),
  targetPages: z.number().int().positive().default(48),
  weights: ScoringWeights.default(() => ScoringWeights.parse({})),
  /** How the book splits into chapters (place runs, days, or none). Openers cost two pages each. */
  chapters: ChapterMode.default('auto'),
});
export type SelectionRules = z.infer<typeof SelectionRules>;

export const Decision = z.enum(['auto-in', 'auto-out', 'user-in', 'user-out']);
export type Decision = z.infer<typeof Decision>;

/** Normalized focal point and crop, all fractions of the source image. */
export const Crop = z.object({
  focalX: z.number().min(0).max(1).default(0.5),
  focalY: z.number().min(0).max(1).default(0.5),
  /** Zoom factor >= 1 applied around the focal point after cover-fit. */
  zoom: z.number().min(1).max(4).default(1),
});
export type Crop = z.infer<typeof Crop>;

export const SlotContent = z.object({
  slotId: Id,
  assetId: Id.optional(),
  crop: Crop.optional(),
  text: z.string().optional(),
});
export type SlotContent = z.infer<typeof SlotContent>;

export const Page = z.object({
  id: Id,
  index: z.number().int().nonnegative(),
  templateId: Id,
  chapterId: Id.optional(),
  slots: z.array(SlotContent),
});
export type Page = z.infer<typeof Page>;

export const Chapter = z.object({
  id: Id,
  title: z.string(),
  subtitle: z.string().optional(),
  startsAtPage: z.number().int().nonnegative(),
});
export type Chapter = z.infer<typeof Chapter>;

/**
 * The book's cover: one cover template, the hero photo (and any text overrides) as slot contents,
 * plus the spine and back-cover text. Text slots left out fall back to the book title and dates.
 */
export const BookCover = z.object({
  templateId: z.literal('cover-editorial').default('cover-editorial'),
  slots: z.array(SlotContent).default([]),
  /** Text on the spine; defaults to the title. Hidden when the spine is thinner than 0.25 in. */
  spineText: z.string().optional(),
  /** Back-cover paragraph. */
  blurb: z.string().optional(),
});
export type BookCover = z.infer<typeof BookCover>;

export const BookStatus = z.enum(['draft', 'selecting', 'editing', 'rendering', 'rendered', 'ordered']);
export type BookStatus = z.infer<typeof BookStatus>;

export const Book = z.object({
  id: Id,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  formatId: Id,
  themeId: Id,
  luluProduct: LuluProduct.default(() => LuluProduct.parse({})),
  status: BookStatus.default('draft'),
  rules: SelectionRules.optional(),
  chapters: z.array(Chapter).default([]),
  pages: z.array(Page).default([]),
  /** Created by the layout when absent (M4); only Lulu formats render it. */
  cover: BookCover.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Book = z.infer<typeof Book>;

/** Cached Immich metadata for one photo that belongs to a book (table book_assets). */
export const BookAsset = z.object({
  id: Id,
  /** Capture time (EXIF dateTimeOriginal, else Immich fileCreatedAt), ISO 8601. */
  takenAt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** width / height after EXIF orientation; 1.5 when unknown. */
  ratio: z.number().positive(),
  city: z.string().optional(),
  /** Region / state / province from Immich's reverse geocoding. */
  state: z.string().optional(),
  country: z.string().optional(),
  /** GPS position when the photo has one. */
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  description: z.string().optional(),
  isFavorite: z.boolean().default(false),
  /** EXIF star rating 1-5 when set in Immich. */
  rating: z.number().int().min(0).max(5).optional(),
  /** Named people Immich recognised (no boxes; those come from /faces on demand). */
  people: z.array(z.object({ id: Id, name: z.string() })).default([]),
  /** Immich duplicate-group id, when Immich has flagged this photo. */
  duplicateId: z.string().optional(),
  fileName: z.string().optional(),
});
export type BookAsset = z.infer<typeof BookAsset>;

/* ---------- Selection engine (M2) ---------- */

/** Raw numbers measured on the 512 px preview; scores are derived from these. */
export const ImageMetrics = z.object({
  /** Variance of a 3x3 Laplacian over the greyscale image. Sharp photos are in the hundreds. */
  laplacianVar: z.number().nonnegative(),
  meanLuma: z.number().min(0).max(255),
  stdevLuma: z.number().nonnegative(),
  /** Fraction of pixels below 8. */
  clipDark: z.number().min(0).max(1),
  /** Fraction of pixels above 247. */
  clipBright: z.number().min(0).max(1),
  /** Hasler-Suesstrunk colourfulness; 0 for greyscale, ~40 for a typical photo, 80+ for saturated. */
  colorfulness: z.number().nonnegative(),
  /** Share of gradient energy near the rule-of-thirds points, 0..1 (uniform is about 0.25). */
  thirds: z.number().min(0).max(1),
});
export type ImageMetrics = z.infer<typeof ImageMetrics>;

/** All 0..1. `composite` is what the picker ranks by. */
export const Scores = z.object({
  sharpness: z.number().min(0).max(1),
  exposure: z.number().min(0).max(1),
  aesthetic: z.number().min(0).max(1),
  people: z.number().min(0).max(1),
  composite: z.number().min(0).max(1),
});
export type Scores = z.infer<typeof Scores>;

/** A face box as fractions of the displayed image (after EXIF orientation). */
export const FaceBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  personId: Id.optional(),
  name: z.string().optional(),
});
export type FaceBox = z.infer<typeof FaceBox>;

export const AutoDecision = z.enum(['auto-in', 'auto-out']);
export type AutoDecision = z.infer<typeof AutoDecision>;

export const ReasonKind = z.enum([
  'top-score',
  'favorite',
  'best-of-burst',
  'featured-person',
  'user-in',
  'user-out',
  'duplicate',
  'blurry',
  'variety',
  'chapter',
  'below-cut',
  'no-analysis',
]);
export type ReasonKind = z.infer<typeof ReasonKind>;

/** Why a photo is in or out. `kind` is stable for the UI; `text` is the human sentence. */
export const Reason = z.object({
  kind: ReasonKind,
  text: z.string(),
  /** Related asset (the burst winner for `duplicate`). */
  assetId: Id.optional(),
});
export type Reason = z.infer<typeof Reason>;

/** One photo's place in a book's selection (table candidates). */
export const Candidate = z.object({
  assetId: Id,
  scores: Scores,
  metrics: ImageMetrics.optional(),
  /** 64-bit DCT perceptual hash as 16 hex characters. */
  phash: z.string().length(16).optional(),
  faces: z.array(FaceBox).optional(),
  /** Near-duplicate group; members share it. Absent for singletons. */
  clusterId: Id.optional(),
  clusterSize: z.number().int().positive().default(1),
  /** 0 = the group's best photo; the rest are its alternates. */
  clusterRank: z.number().int().nonnegative().default(0),
  /** Chapter this photo belongs to in the book's chapter plan (see planChapters). */
  chapterId: Id.optional(),
  blurry: z.boolean().default(false),
  /** What the engine decided; `decision` may override it with a user choice. */
  autoDecision: AutoDecision,
  decision: Decision,
  reasons: z.array(Reason).default([]),
});
export type Candidate = z.infer<typeof Candidate>;

export function isPicked(c: Pick<Candidate, 'decision'>): boolean {
  return c.decision === 'auto-in' || c.decision === 'user-in';
}

export const SelectionSummary = z.object({
  total: z.number().int().nonnegative(),
  analyzed: z.number().int().nonnegative(),
  picked: z.number().int().nonnegative(),
  /** Near-duplicates of another photo (clusterRank > 0) that are not picked. */
  alternates: z.number().int().nonnegative(),
  /** Not picked and not an alternate. */
  rejected: z.number().int().nonnegative(),
  blurry: z.number().int().nonnegative(),
  clusters: z.number().int().nonnegative(),
  days: z.number().int().nonnegative(),
  places: z.number().int().nonnegative(),
  /** Planned chapters (0 = the book has none). */
  chapters: z.number().int().nonnegative().default(0),
  targetPhotos: z.number().int().nonnegative(),
});
export type SelectionSummary = z.infer<typeof SelectionSummary>;

/** One planned chapter as the review page sees it. */
export const ChapterSummary = z.object({
  id: Id,
  title: z.string(),
  subtitle: z.string(),
  total: z.number().int().nonnegative(),
  picked: z.number().int().nonnegative(),
});
export type ChapterSummary = z.infer<typeof ChapterSummary>;

export const SelectionPhase = z.enum(['queued', 'gather', 'analyze', 'faces', 'pick', 'done']);
export type SelectionPhase = z.infer<typeof SelectionPhase>;

/** A queued/running/finished selection job for a book. */
export const SelectionRun = z.object({
  id: Id,
  bookId: Id,
  status: z.enum(['queued', 'running', 'done', 'error']),
  phase: SelectionPhase,
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
});
export type SelectionRun = z.infer<typeof SelectionRun>;

export const SelectionView = z.object({
  candidates: z.array(Candidate),
  summary: SelectionSummary.optional(),
  /** Latest run, if any. */
  run: SelectionRun.optional(),
  /** The chapter plan for the current rules, chronological. */
  chapters: z.array(ChapterSummary).default([]),
});
export type SelectionView = z.infer<typeof SelectionView>;

export const StartSelectionInput = z.object({
  /** Re-fetch the photo list from Immich first (default: only when none is stored). */
  refetch: z.boolean().optional(),
  /** Replace the book's rules (weights, toggles) before running. */
  rules: SelectionRules.optional(),
});
export type StartSelectionInput = z.infer<typeof StartSelectionInput>;

export const DecisionChoice = z.enum(['user-in', 'user-out', 'auto']);
export type DecisionChoice = z.infer<typeof DecisionChoice>;
export const DecisionsInput = z.object({
  decisions: z.array(z.object({ assetId: Id, decision: DecisionChoice })).min(1).max(500),
});
export type DecisionsInput = z.infer<typeof DecisionsInput>;

/**
 * Photos the picker aims for: about three per body page (title page and a trailing blank excluded).
 * Each chapter costs an opener spread (two pages) and its hero photo counts as one pick.
 */
export const PHOTOS_PER_PAGE = 2.8;
export function targetPhotosFor(targetPages: number, chapterCount = 0): number {
  const openers = chapterCount > 0 ? 2 * chapterCount : 0;
  const body = Math.max(2, targetPages - 2 - openers);
  return Math.max(4, Math.round(body * PHOTOS_PER_PAGE) + chapterCount);
}

/**
 * proof = interior PDF at screen resolution; print = interior PDF at 300 ppi from originals;
 * cover = one-page cover PDF (back, spine, front) at 300 ppi; preview = one PNG per page for the viewer.
 */
export const RenderKind = z.enum(['proof', 'print', 'cover', 'preview']);
export type RenderKind = z.infer<typeof RenderKind>;
export const RenderStatus = z.enum(['queued', 'running', 'done', 'error']);
export type RenderStatus = z.infer<typeof RenderStatus>;

/** Size of the one-page cover PDF and how the spine was decided (see packages/layout/src/cover.ts). */
export const CoverGeometry = z.object({
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  spineIn: z.number().nonnegative(),
  /** Paper beyond the trim on every outer edge (wrap for hardcovers, bleed otherwise). */
  wrapIn: z.number().nonnegative(),
  /** Left edge of the front cover's trim box, from the sheet's left edge. */
  frontLeftIn: z.number().nonnegative(),
  /** estimate = caliper × pages (M4); lulu = Lulu's /cover-dimensions/ answer (M5). */
  source: z.enum(['estimate', 'lulu']),
});
export type CoverGeometry = z.infer<typeof CoverGeometry>;

/** Per-render facts the job needs later (stored as JSON in renders.data). */
export const RenderData = z.object({
  /** Cover renders: the geometry the sheet was sized with and the interior page count it assumed. */
  cover: z.object({ geometry: CoverGeometry, pageCount: z.number().int().nonnegative() }).optional(),
  /** Preview renders: whether cover.png was written next to the page PNGs. */
  hasCover: z.boolean().optional(),
});
export type RenderData = z.infer<typeof RenderData>;

/** A render job of a book: a PDF (proof, print, cover) or the page PNGs the public viewer shows (preview). */
export const RenderJob = z.object({
  id: Id,
  bookId: Id,
  kind: RenderKind,
  status: RenderStatus,
  pagesTotal: z.number().int().nonnegative(),
  pagesDone: z.number().int().nonnegative(),
  /** Set when status = done. */
  pageCount: z.number().int().nonnegative().optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string()).default([]),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
  data: RenderData.optional(),
  /** Authenticated download URL (relative), present when a PDF render is done. */
  downloadUrl: z.string().optional(),
});
export type RenderJob = z.infer<typeof RenderJob>;

/** Admin URL of one page PNG of a done preview render (`n` is the 0-based page index). */
export function renderPageUrl(bookId: string, renderId: string, n: number): string {
  return `/api/books/${encodeURIComponent(bookId)}/renders/${encodeURIComponent(renderId)}/pages/${n}.png`;
}
export function renderCoverUrl(bookId: string, renderId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/renders/${encodeURIComponent(renderId)}/cover.png`;
}

export const CreateRenderInput = z.object({ kind: RenderKind.default('proof') });
export type CreateRenderInput = z.infer<typeof CreateRenderInput>;

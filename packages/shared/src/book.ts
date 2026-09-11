import { z } from 'zod';
import { LuluProduct } from './format.js';

export const Id = z.string().min(1);

/** Which photos feed a book. Several sources are unioned, then filters apply. */
export const SelectionSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('album'), albumIds: z.array(Id).min(1) }),
  z.object({
    kind: z.literal('trip'),
    takenAfter: z.iso.datetime(),
    takenBefore: z.iso.datetime(),
    /** WGS84 boxes [west, south, east, north]; empty = anywhere in the date range. */
    bboxes: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).default([]),
  }),
  z.object({ kind: z.literal('people'), personIds: z.array(Id).min(1) }),
  z.object({ kind: z.literal('smart'), query: z.string().min(1), queryAssetId: Id.optional() }),
  z.object({ kind: z.literal('favorites') }),
]);
export type SelectionSource = z.infer<typeof SelectionSource>;

export const ScoringWeights = z.object({
  sharpness: z.number().min(0).max(1).default(0.7),
  people: z.number().min(0).max(1).default(0.6),
  aesthetic: z.number().min(0).max(1).default(0.45),
  variety: z.number().min(0).max(1).default(0.8),
});
export type ScoringWeights = z.infer<typeof ScoringWeights>;

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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Book = z.infer<typeof Book>;

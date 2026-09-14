import type { FaceBox, ImageMetrics, Scores, ScoringWeights } from '@bookbinder/shared';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Laplacian variance on a log scale: about 10 -> 0, 100 -> 0.5, 1000 -> 1. Measured on a 512 px
 * preview, crisp photos sit above 0.6 and motion-blurred or out-of-focus ones below 0.25.
 */
export function sharpnessScore(laplacianVar: number): number {
  return clamp01((Math.log10(laplacianVar + 1) - 1) / 2);
}

/** Penalises a mean far from mid-grey, clipped shadows/highlights and flat contrast. */
export function exposureScore(m: Pick<ImageMetrics, 'meanLuma' | 'stdevLuma' | 'clipDark' | 'clipBright'>): number {
  const midPenalty = clamp01((Math.abs(m.meanLuma - 118) - 30) / 90);
  const clipPenalty = clamp01((m.clipDark + m.clipBright) * 4);
  const contrast = clamp01((m.stdevLuma - 15) / 45);
  return clamp01((1 - 0.5 * midPenalty - 0.5 * clipPenalty) * (0.6 + 0.4 * contrast));
}

/**
 * A heuristic stand-in for a learned aesthetic model: colourfulness, tonal range, clean
 * highlights/shadows and rule-of-thirds energy. Deliberately simple and explainable.
 */
export function aestheticScore(m: ImageMetrics): number {
  const colour = clamp01(m.colorfulness / 80);
  const tonal = clamp01((m.stdevLuma - 20) / 50);
  const clean = 1 - clamp01((m.clipDark + m.clipBright) * 3);
  const thirds = clamp01((m.thirds - 0.15) / 0.35);
  return clamp01(0.35 * colour + 0.25 * tonal + 0.2 * clean + 0.2 * thirds);
}

export interface PeopleInput {
  /** Named people Immich lists on the asset (no geometry). */
  people: ReadonlyArray<{ id: string; name: string }>;
  /** Face boxes when fetched; refine size and placement. */
  faces?: ReadonlyArray<FaceBox> | undefined;
  featuredPersonIds: ReadonlySet<string>;
}

/**
 * 0.45 when nobody is in the shot (neutral, so scenery is not punished by the people weight),
 * higher for named and featured people, adjusted by face size, centrality and cut-off faces.
 */
export function peopleScore(input: PeopleInput): number {
  const { people, faces, featuredPersonIds } = input;
  const faceCount = faces?.length ?? 0;
  if (faceCount === 0 && people.length === 0) return 0.45;
  const hasFeatured = people.some((p) => featuredPersonIds.has(p.id)) || (faces?.some((f) => f.personId !== undefined && featuredPersonIds.has(f.personId)) ?? false);
  const named = people.filter((p) => p.name.trim().length > 0).length;
  let base = hasFeatured ? 0.9 : named > 0 ? 0.75 : 0.6;
  if (faces && faces.length > 0) {
    let largest = faces[0]!;
    for (const f of faces) if (f.w * f.h > largest.w * largest.h) largest = f;
    const area = Math.max(1e-6, largest.w * largest.h);
    // 0.2% of the frame -> 0 (a bystander), 1% -> 0.4, 4% -> 0.76, 10%+ -> 1 (a portrait).
    const size = clamp01((Math.log10(area) + 2.7) / 1.7);
    const cx = largest.x + largest.w / 2;
    const cy = largest.y + largest.h / 2;
    const dist = Math.hypot((cx - 0.5) / 0.5, (cy - 0.5) / 0.5) / Math.SQRT2;
    const central = 1 - clamp01(dist);
    const cut = faces.some((f) => f.x <= 0.005 || f.y <= 0.005 || f.x + f.w >= 0.995 || f.y + f.h >= 0.995) ? 0.1 : 0;
    base = base * (0.55 + 0.3 * size + 0.15 * central) + 0.1 * Math.min(1, faces.length / 3) - cut;
  }
  return clamp01(base);
}

export interface CompositeExtras {
  isFavorite?: boolean | undefined;
  /** EXIF rating 1-5; 3 is neutral. */
  rating?: number | undefined;
}

/**
 * Weighted mean of technical (sharpness + exposure), people and aesthetic scores, plus a small
 * bonus for favourites and star ratings. The variety weight is used by the picker, not here.
 */
export function compositeScore(s: Omit<Scores, 'composite'>, w: ScoringWeights, extras: CompositeExtras = {}): number {
  const technical = 0.65 * s.sharpness + 0.35 * s.exposure;
  const sum = w.sharpness + w.people + w.aesthetic;
  let c = sum > 0 ? (w.sharpness * technical + w.people * s.people + w.aesthetic * s.aesthetic) / sum : technical;
  if (extras.isFavorite) c += 0.08;
  if (extras.rating) c += (extras.rating - 3) * 0.02;
  return clamp01(c);
}

/** All five scores for one photo. Without metrics (undecodable preview) the image scores read as average. */
export function scoreCandidate(metrics: ImageMetrics | undefined, people: PeopleInput, weights: ScoringWeights, extras: CompositeExtras = {}): Scores {
  const sharpness = metrics ? sharpnessScore(metrics.laplacianVar) : 0.5;
  const exposure = metrics ? exposureScore(metrics) : 0.5;
  const aesthetic = metrics ? aestheticScore(metrics) : 0.5;
  const ppl = peopleScore(people);
  return { sharpness, exposure, aesthetic, people: ppl, composite: compositeScore({ sharpness, exposure, aesthetic, people: ppl }, weights, extras) };
}

/**
 * Blurry = low absolute sharpness AND far below the book's median, so a deliberately soft series
 * (fog, long exposures) is not wiped out.
 */
export function isBlurry(laplacianVar: number, medianVar: number): boolean {
  return sharpnessScore(laplacianVar) < 0.25 && laplacianVar < 0.2 * medianVar;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

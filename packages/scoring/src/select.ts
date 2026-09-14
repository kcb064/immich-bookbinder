import type { BookAsset, Candidate, Decision, FaceBox, ImageMetrics, Reason, SelectionRules, SelectionSummary } from '@bookbinder/shared';
import { chapterIndex, planChapters, targetPhotosFor, type ChapterPlan } from '@bookbinder/shared';
import { clusterNearDuplicates } from './cluster.js';
import { dayOf, pickPhotos, type PickItem } from './pick.js';
import { isBlurry, median, scoreCandidate, sharpnessScore } from './score.js';

export interface SelectionInput {
  asset: BookAsset;
  metrics?: ImageMetrics | undefined;
  phash?: string | undefined;
  faces?: FaceBox[] | undefined;
  /** Previous decision; only user-in / user-out are honoured. */
  decision?: Decision | undefined;
}

export interface SelectionOptions {
  rules: SelectionRules;
  /** Defaults to targetPhotosFor(rules.targetPages, chapters). */
  targetPhotos?: number | undefined;
}

export interface SelectionResult {
  candidates: Candidate[];
  summary: SelectionSummary;
  /** The chapter plan the picker budgeted against (empty when the book has no chapters). */
  chapters: ChapterPlan[];
}

const fmt = (score: number): string => (score * 10).toFixed(1);

/**
 * The whole pure pipeline after image analysis: score -> cluster near-duplicates -> pick with
 * diversity -> explain. User decisions carried in `inputs[].decision` are kept and force the pick.
 */
export function buildSelection(inputs: readonly SelectionInput[], opts: SelectionOptions): SelectionResult {
  const rules = opts.rules;
  const chapters = planChapters(inputs.map((i) => i.asset), { mode: rules.chapters, targetPages: rules.targetPages });
  const chapterOf = chapterIndex(chapters);
  const target = Math.max(1, opts.targetPhotos ?? targetPhotosFor(rules.targetPages, chapters.length));
  const featured = new Set(rules.featuredPersonIds);
  const medianVar = median(inputs.filter((i) => i.metrics).map((i) => i.metrics!.laplacianVar));

  const scored = inputs.map((input) => {
    const scores = scoreCandidate(
      input.metrics,
      { people: input.asset.people, faces: input.faces, featuredPersonIds: featured },
      rules.weights,
      { isFavorite: input.asset.isFavorite, rating: input.asset.rating },
    );
    const blurry = input.metrics ? isBlurry(input.metrics.laplacianVar, medianVar) : false;
    return { input, scores, blurry };
  });
  const byId = new Map(scored.map((s) => [s.input.asset.id, s]));

  const forcedIn = new Set(scored.filter((s) => s.input.decision === 'user-in').map((s) => s.input.asset.id));
  const forcedOut = new Set(scored.filter((s) => s.input.decision === 'user-out').map((s) => s.input.asset.id));

  // Near-duplicate groups; the best member (user choice, favourite, sharp, high score) wins.
  const clusters = rules.collapseNearDuplicates
    ? clusterNearDuplicates(scored.map((s) => ({ id: s.input.asset.id, takenAt: s.input.asset.takenAt, phash: s.input.phash, duplicateId: s.input.asset.duplicateId })))
    : new Map<string, string[]>();
  const clusterOf = new Map<string, { id: string; rank: number; size: number; winner: string }>();
  for (const [clusterId, members] of clusters) {
    const ordered = [...members].sort((a, b) => {
      const A = byId.get(a)!;
      const B = byId.get(b)!;
      const key = (s: typeof A): number =>
        (forcedIn.has(s.input.asset.id) ? 8 : 0) + (forcedOut.has(s.input.asset.id) ? -8 : 0) + (rules.includeFavoritesAlways && s.input.asset.isFavorite ? 4 : 0) + (s.blurry ? -2 : 0);
      return key(B) - key(A) || B.scores.composite - A.scores.composite || a.localeCompare(b);
    });
    ordered.forEach((id, rank) => clusterOf.set(id, { id: clusterId, rank, size: ordered.length, winner: ordered[0]! }));
  }

  const items: PickItem[] = scored.map((s) => {
    const c = clusterOf.get(s.input.asset.id);
    const chapter = chapterOf.get(s.input.asset.id);
    return {
      id: s.input.asset.id,
      score: s.scores.composite,
      takenAt: s.input.asset.takenAt,
      place: s.input.asset.city,
      chapter: chapter ? { id: chapter.id, title: chapter.title } : undefined,
      isFavorite: s.input.asset.isFavorite,
      personIds: s.input.asset.people.map((p) => p.id),
      eligible: (c?.rank ?? 0) === 0 && !(rules.skipBlurry && s.blurry),
    };
  });
  const picked = pickPhotos(items, {
    target,
    variety: rules.weights.variety,
    spreadAcrossDays: rules.spreadAcrossDays,
    includeFavoritesAlways: rules.includeFavoritesAlways,
    featuredPersonIds: rules.featuredPersonIds,
    forcedIn,
    forcedOut,
  });

  const candidates: Candidate[] = scored.map((s) => {
    const id = s.input.asset.id;
    const c = clusterOf.get(id);
    const decision = picked.decisions.get(id);
    const userIn = forcedIn.has(id);
    const userOut = forcedOut.has(id);
    const eligible = (c?.rank ?? 0) === 0 && !(rules.skipBlurry && s.blurry);
    const autoIn = userIn || userOut ? eligible && s.scores.composite >= picked.cut : (decision?.picked ?? false);

    const reasons: Reason[] = [];
    if (!s.input.metrics) reasons.push({ kind: 'no-analysis', text: 'Could not analyse this photo; image scores read as average.' });
    if (userIn) reasons.push({ kind: 'user-in', text: 'You kept this photo.' });
    if (userOut) reasons.push({ kind: 'user-out', text: 'You removed this photo.' });
    if (c && c.rank > 0) {
      reasons.push({ kind: 'duplicate', text: `Near-duplicate of a better shot (best of ${c.size}).`, assetId: c.winner });
    } else if (c && decision?.picked) {
      reasons.push({ kind: 'best-of-burst', text: `Best of ${c.size} taken within moments of each other.` });
    }
    if (s.blurry) reasons.push({ kind: 'blurry', text: `Blurry (sharpness ${fmt(s.scores.sharpness)}${rules.skipBlurry ? '); skipped' : ''}.` });
    if (decision && !userIn && !userOut) for (const r of decision.reasons) if (!reasons.some((x) => x.kind === r.kind)) reasons.push(r);

    return {
      assetId: id,
      scores: s.scores,
      ...(s.input.metrics ? { metrics: s.input.metrics } : {}),
      ...(s.input.phash ? { phash: s.input.phash } : {}),
      ...(s.input.faces ? { faces: s.input.faces } : {}),
      ...(c ? { clusterId: c.id, clusterSize: c.size, clusterRank: c.rank } : { clusterSize: 1, clusterRank: 0 }),
      ...(chapterOf.has(id) ? { chapterId: chapterOf.get(id)!.id } : {}),
      blurry: s.blurry,
      autoDecision: autoIn ? 'auto-in' : 'auto-out',
      decision: userIn ? 'user-in' : userOut ? 'user-out' : autoIn ? 'auto-in' : 'auto-out',
      reasons,
    };
  });

  return { candidates, summary: summarize(candidates, inputs, target, chapters.length), chapters };
}

export function summarize(candidates: readonly Candidate[], inputs: readonly Pick<SelectionInput, 'asset' | 'metrics'>[], targetPhotos: number, chapters = 0): SelectionSummary {
  let picked = 0;
  let alternates = 0;
  let rejected = 0;
  let blurry = 0;
  const clusterIds = new Set<string>();
  for (const c of candidates) {
    const isIn = c.decision === 'auto-in' || c.decision === 'user-in';
    if (isIn) picked++;
    else if (c.clusterRank > 0) alternates++;
    else rejected++;
    if (c.blurry) blurry++;
    if (c.clusterId) clusterIds.add(c.clusterId);
  }
  const days = new Set(inputs.map((i) => dayOf(i.asset.takenAt)));
  const places = new Set(inputs.map((i) => i.asset.city).filter((c): c is string => Boolean(c)));
  return {
    total: candidates.length,
    analyzed: inputs.filter((i) => i.metrics).length,
    picked,
    alternates,
    rejected,
    blurry,
    clusters: clusterIds.size,
    days: days.size,
    places: places.size,
    chapters,
    targetPhotos,
  };
}

export { sharpnessScore };

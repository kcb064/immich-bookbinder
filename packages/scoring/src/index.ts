/**
 * Pure photo scoring for immich-bookbinder (M2): image metrics on decoded pixel buffers, a DCT
 * perceptual hash, near-duplicate clustering, diversity-aware picking and the assembled,
 * explainable selection. No native dependencies: the server decodes previews with sharp and
 * hands the raw buffers in.
 */
export const SCORING_VERSION = '1.0.0';

export * from './metrics.js';
export * from './phash.js';
export * from './score.js';
export * from './cluster.js';
export * from './pick.js';
export * from './select.js';

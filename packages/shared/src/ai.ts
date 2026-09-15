import { z } from 'zod';
import { Id } from './book.js';

/*
 * Optional Claude features (M7). Everything here is off until the admin turns it on in Settings
 * and stores their own API key; only Immich thumbnails ever leave the server (docs/ai.md).
 */

/** Models the Settings page offers, with Anthropic's list prices (USD per million tokens, 2026-06). */
export interface AiModel {
  id: string;
  name: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

export const AI_MODELS: readonly AiModel[] = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', inputPerMTok: 5, outputPerMTok: 25 },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', inputPerMTok: 2, outputPerMTok: 10 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5 },
];

/**
 * Whether a model takes `output_config.effort`. The 4.5 generation (Haiku 4.5, Sonnet 4.5) rejects
 * it with a 400; every current Opus and Sonnet model, and Haiku models after 4.5, accept it.
 */
export function supportsEffort(model: string): boolean {
  return !/^claude-(haiku|sonnet)-4-5/.test(model);
}

/** The current Claude model at build time; configurable in Settings. */
export const DEFAULT_AI_MODEL = 'claude-opus-5';

/** Cost estimate in USD from the token counts, using the price list (0 for an unknown model). */
export function estimateAiCost(model: string, inputTokens: number, outputTokens: number): number {
  const m = AI_MODELS.find((x) => x.id === model);
  if (!m) return 0;
  return (inputTokens * m.inputPerMTok + outputTokens * m.outputPerMTok) / 1_000_000;
}

export const AiJobKind = z.enum(['captions', 'bursts', 'foreword']);
export type AiJobKind = z.infer<typeof AiJobKind>;

export const AiJobStatus = z.enum(['queued', 'running', 'done', 'error']);
export type AiJobStatus = z.infer<typeof AiJobStatus>;

export const AiUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Requests made to the API. */
  requests: z.number().int().nonnegative(),
  /** Estimated from the price list; the invoice may differ. */
  costUsd: z.number().nonnegative(),
});
export type AiUsage = z.infer<typeof AiUsage>;

/** What a finished job did, per kind. */
export const AiJobResult = z.object({
  /** captions: captions written / chapter titles written / slots skipped because the user had typed there. */
  captions: z.number().int().nonnegative().optional(),
  chapterTitles: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(),
  /** bursts: clusters asked about / winners changed; `skipped` counts bursts the user decided while the job ran. */
  clusters: z.number().int().nonnegative().optional(),
  changed: z.number().int().nonnegative().optional(),
  /** foreword: the paragraph written to the title page. */
  text: z.string().optional(),
});
export type AiJobResult = z.infer<typeof AiJobResult>;

export const AiJob = z.object({
  id: Id,
  bookId: Id,
  kind: AiJobKind,
  status: AiJobStatus,
  model: z.string(),
  /** Photos (or clusters) processed so far, for the progress bar. */
  total: z.number().int().nonnegative().default(0),
  done: z.number().int().nonnegative().default(0),
  usage: AiUsage.optional(),
  result: AiJobResult.optional(),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
});
export type AiJob = z.infer<typeof AiJob>;

/** `PUT /api/settings/ai`. The key is optional (keeps the stored one) and never shown again. */
export const AiSettingsInput = z.object({
  enabled: z.boolean(),
  /** Absent keeps the stored key; empty removes it. */
  apiKey: z.string().max(500).optional(),
  model: z.string().min(1).max(100).optional(),
});
export type AiSettingsInput = z.infer<typeof AiSettingsInput>;

/** What `POST /api/ai/test` reports: one tiny request with the stored key. */
export const AiTest = z.object({ ok: z.boolean(), model: z.string(), error: z.string().optional(), usage: AiUsage.optional() });
export type AiTest = z.infer<typeof AiTest>;

/** `POST /api/books/:id/ai/foreword` body. */
export const ForewordInput = z.object({
  /** Replace a foreword the user already typed (default: leave it alone). */
  overwrite: z.boolean().default(false),
});
export type ForewordInput = z.infer<typeof ForewordInput>;

/* ---------- What the model is asked for (structured outputs) ---------- */

export const CaptionAnswer = z.object({
  captions: z.array(z.object({ page: z.number().int().nonnegative(), caption: z.string().max(200) })),
  chapters: z.array(z.object({ id: z.string(), title: z.string().max(60) })),
});
export type CaptionAnswer = z.infer<typeof CaptionAnswer>;

export const BurstAnswer = z.object({
  /** 0-based index of the best frame in the order the frames were sent, with a short reason. */
  best: z.number().int().nonnegative(),
  reason: z.string().max(200),
});
export type BurstAnswer = z.infer<typeof BurstAnswer>;

export const ForewordAnswer = z.object({ foreword: z.string().max(1200) });
export type ForewordAnswer = z.infer<typeof ForewordAnswer>;

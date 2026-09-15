import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

/** What one call cost, straight from the API's usage block. */
export interface AiCallUsage {
  inputTokens: number;
  outputTokens: number;
}

/** An image for the model: always a small JPEG (see ImageStore.aiThumbnail), never an original. */
export interface AiImage {
  jpeg: Buffer;
  /** Text shown right before the image ("Frame 1, 10:32"). */
  label?: string;
}

export interface AiAskOptions<T> {
  system: string;
  /** The prompt, with any images interleaved before it. */
  text: string;
  images?: readonly AiImage[];
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface AiClientOptions {
  apiKey: string;
  model: string;
  /** Development only: the fake (src/test/fake-claude.ts). */
  baseUrl?: string | undefined;
  timeoutMs?: number;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Human sentence for an SDK error (typed classes first, then the generic API error). */
export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key (401). Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'The API key is not allowed to use this model (403).';
  if (err instanceof Anthropic.NotFoundError) return 'The model was not found (404); pick another one in Settings.';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate-limited the request (429); try again in a minute.';
  if (err instanceof Anthropic.BadRequestError) return `Anthropic refused the request (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `Could not reach the Anthropic API: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Anthropic answered ${err.status ?? 'an error'}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Thin wrapper over the Anthropic SDK: one structured-output request at a time, thumbnails as
 * base64 JPEG, the parsed answer plus the token usage. Thinking stays adaptive (the default) at
 * low effort: captions and picks are quick judgements, not reasoning problems.
 */
export class AiClient {
  private readonly client: Anthropic;
  readonly model: string;

  constructor(opts: AiClientOptions) {
    this.model = opts.model;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
      timeout: opts.timeoutMs ?? 120_000,
      maxRetries: 2,
    });
  }

  async ask<T>(opts: AiAskOptions<T>): Promise<{ data: T; usage: AiCallUsage }> {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const [i, img] of (opts.images ?? []).entries()) {
      content.push({ type: 'text', text: img.label ?? `Image ${i + 1}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.jpeg.toString('base64') } });
    }
    content.push({ type: 'text', text: opts.text });
    let message: Anthropic.Message & { parsed_output?: unknown };
    try {
      message = await this.client.messages.parse({
        model: this.model,
        max_tokens: opts.maxTokens ?? 4096,
        system: opts.system,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'low', format: zodOutputFormat(opts.schema) },
      });
    } catch (err) {
      throw new AiError(describeAiError(err), err instanceof Anthropic.APIError ? err.status : undefined);
    }
    if (message.stop_reason === 'refusal') throw new AiError(`Claude declined the request${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : ''}`);
    const parsed = message.parsed_output as T | null | undefined;
    if (parsed === null || parsed === undefined) {
      // No structured answer (an older model, or the fake): parse the text ourselves.
      const text = message.content.find((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
      const result = opts.schema.safeParse(parseLooseJson(text));
      if (!result.success) throw new AiError(`Claude answered something unexpected: ${text.slice(0, 200)}`);
      return { data: result.data, usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } };
    }
    return { data: parsed, usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } };
  }
}

/** JSON from a text answer that may be wrapped in a code fence. */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

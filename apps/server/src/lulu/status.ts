import type { LuluStatus } from '@bookbinder/shared';
import { createLuluClient, LuluApiError, luluErrorLines, type LuluClientOptions } from './client.js';

/** A readable line for any failure of a Lulu call (API errors carry Lulu's own message). */
export function describeLuluError(err: unknown): string {
  if (err instanceof LuluApiError) {
    const lines = luluErrorLines(err.body);
    if (err.status === 401 && lines.length === 0) return 'Lulu rejected the credentials (HTTP 401)';
    return lines.length > 0 ? `${lines.join('; ')} (HTTP ${err.status})` : `HTTP ${err.status} from ${err.path}`;
  }
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
  }
  return String(err);
}

/**
 * Proves a key/secret pair: the token exchange, then one authenticated call (`GET /print-jobs/`
 * with page_size 1). Used by POST /api/lulu/test. Never throws.
 */
export async function testLuluConnection(opts: LuluClientOptions): Promise<LuluStatus> {
  const client = createLuluClient({ timeoutMs: 15_000, ...opts });
  const status: LuluStatus = { ok: false, env: opts.env, baseUrl: client.baseUrl };
  try {
    const list = await client.listPrintJobs({ page_size: 1 });
    status.ok = true;
    if (list.count !== undefined) status.printJobs = list.count;
  } catch (err) {
    status.error = describeLuluError(err);
  }
  return status;
}

import type { ReachabilityReport } from '@bookbinder/shared';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { ExportStore } from './exports.js';
import { exportPath } from './exports.js';

/** The probe export lives a few minutes; long enough for the one fetch, short enough to never matter. */
const PROBE_TTL_MS = 10 * 60_000;

export interface ReachabilityDeps {
  exports: ExportStore;
  /** Where the throwaway PDF is written (DATA_DIR/exports). */
  exportsDir: string;
  /** Configured public base (settings or PUBLIC_URL), without a trailing slash. */
  publicBase: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** A one-page PDF that says what it is, so anyone who finds it in a log knows it is harmless. */
export async function probePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([288, 144]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('immich-bookbinder reachability probe', { x: 24, y: 80, size: 12, font });
  page.drawText('Lulu downloads print files from URLs like this one.', { x: 24, y: 56, size: 9, font });
  return doc.save();
}

/**
 * Checks that Lulu will be able to download exports: writes a tiny PDF, publishes it as an export,
 * and fetches it from this server through the public URL, exactly as Lulu would. HTML instead of a
 * PDF is the classic Cloudflare Access failure; the report says so.
 */
export async function checkReachability(deps: ReachabilityDeps): Promise<ReachabilityReport> {
  await mkdir(deps.exportsDir, { recursive: true });
  const filePath = join(deps.exportsDir, 'reachability-probe.pdf');
  await writeFile(filePath, await probePdf());
  const row = await deps.exports.create({ filePath, ttlMs: PROBE_TTL_MS });
  const url = `${deps.publicBase}${exportPath(row.token)}`;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const started = Date.now();
  const report: ReachabilityReport = { ok: false, url, latencyMs: 0, isPdf: false };
  try {
    const res = await fetchImpl(url, {
      redirect: 'manual',
      headers: { accept: 'application/pdf,*/*', 'user-agent': 'immich-bookbinder reachability probe' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
    });
    report.latencyMs = Date.now() - started;
    report.status = res.status;
    const contentType = res.headers.get('content-type');
    if (contentType) report.contentType = contentType;
    const body = Buffer.from(await res.arrayBuffer());
    const looksHtml = /text\/html/i.test(contentType ?? '') || /^\s*<(!doctype|html)/i.test(body.subarray(0, 200).toString('latin1'));
    const isPdf = body.subarray(0, 5).toString('latin1') === '%PDF-';
    const md5 = createHash('md5').update(body).digest('hex');
    report.isPdf = isPdf && md5 === row.md5;
    if (res.status >= 300 && res.status < 400) {
      report.error = `The public URL redirected (HTTP ${res.status} to ${res.headers.get('location') ?? 'somewhere'}); Lulu does not log in.`;
      report.hint = 'A redirect to a login page usually means Cloudflare Access covers /public/*. Add a bypass policy for /public/* (see deploy-dockge.md).';
    } else if (looksHtml) {
      report.error = `Got an HTML page instead of the PDF (HTTP ${res.status}).`;
      report.hint = 'This is what a Cloudflare Access login page or a WAF challenge looks like. Bypass Access for /public/* and add a WAF skip rule for /public/exports/* (see deploy-dockge.md).';
    } else if (!res.ok) {
      report.error = `The public URL answered HTTP ${res.status}.`;
      report.hint = res.status === 404 ? 'PUBLIC_URL may point at another service, or a proxy strips the path. It must reach this app.' : 'Check the tunnel or reverse proxy in front of the app.';
    } else if (!isPdf) {
      report.error = `The body was not a PDF (${contentType ?? 'no content type'}).`;
      report.hint = 'Something between the internet and the app rewrote the response.';
    } else if (md5 !== row.md5) {
      report.error = 'The PDF came back altered (MD5 mismatch).';
      report.hint = 'A proxy is modifying responses; disable compression or rewriting for /public/exports/*.';
    } else {
      report.ok = true;
    }
  } catch (err) {
    report.latencyMs = Date.now() - started;
    const cause = (err as { cause?: unknown }).cause;
    report.error = `Could not fetch the public URL: ${err instanceof Error ? err.message : String(err)}${cause instanceof Error ? ` (${cause.message})` : ''}`;
    report.hint = 'The server itself must be able to reach PUBLIC_URL. Check DNS, the tunnel, and that PUBLIC_URL is the external HTTPS address.';
  } finally {
    deps.exports.delete(row.id);
  }
  return report;
}

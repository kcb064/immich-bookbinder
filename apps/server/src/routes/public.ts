import { FORMAT_PRESETS, UnlockShareInput, type Book, type ViewerBook } from '@bookbinder/shared';
import { dateRangeLabel } from '@bookbinder/pages';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ShareRow } from '../db/schema.js';
import { EXPORT_TOKEN_RE } from '../lulu/exports.js';
import { SHARE_UNLOCK_TTL_MS, shareStatus } from '../shares/store.js';

/** Per-IP limit on every public route; unlock attempts get a tighter one. */
const PUBLIC_RATE = { max: 60, timeWindow: '1 minute' };
const UNLOCK_RATE = { max: 10, timeWindow: '1 minute' };

/** base64url of 32 bytes is 43 characters; anything else is not a token we issued. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function shareCookieName(token: string): string {
  return `bb_share_${token}`;
}

/** Ties the unlock cookie to the current password: changing the password logs every viewer out. */
function passwordTag(row: ShareRow): string {
  return createHash('sha256')
    .update(row.passwordHash ?? '')
    .digest('base64url')
    .slice(0, 12);
}

function unlockedBy(request: FastifyRequest, row: ShareRow, now = Date.now()): boolean {
  if (!row.passwordHash) return true;
  const raw = request.cookies[shareCookieName(row.token)];
  if (!raw) return false;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return false;
  const [id, exp, tag] = unsigned.value.split('.');
  return id === row.id && tag === passwordTag(row) && Number(exp) > now;
}

function fileSlug(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'book'
  );
}

/**
 * The unauthenticated surface: the shared viewer at /s/:token (SPA shell, book.json, page PNGs,
 * PDF, unlock). Every answer is built from stored renders and the book document; no asset ids and
 * nothing from Immich ever leave through here. /public/exports/:token.pdf (M5) serves print files to Lulu.
 */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const gone = (reply: FastifyReply, reason: 'expired' | 'revoked') => reply.code(410).send({ statusCode: 410, error: 'Gone', reason });

  /** Looks the token up and answers 404/410 itself; returns undefined when a reply was sent. */
  const resolve = (request: FastifyRequest, reply: FastifyReply): { share: ShareRow; book: Book } | undefined => {
    const token = (request.params as { token?: string }).token ?? '';
    const share = TOKEN_RE.test(token) ? app.shares.byToken(token) : undefined;
    if (!share) {
      void reply.notFound('This link does not exist');
      return undefined;
    }
    const status = shareStatus(share);
    if (status !== 'active') {
      void gone(reply, status);
      return undefined;
    }
    const book = app.books.get(share.bookId);
    if (!book) {
      void reply.notFound('This book no longer exists');
      return undefined;
    }
    return { share, book };
  };

  /** Like resolve, plus the password gate: 401 { needsPassword: true } without a valid unlock cookie. */
  const resolveUnlocked = (request: FastifyRequest, reply: FastifyReply): { share: ShareRow; book: Book } | undefined => {
    const r = resolve(request, reply);
    if (!r) return undefined;
    if (!unlockedBy(request, r.share)) {
      void reply.code(401).send({ statusCode: 401, error: 'Unauthorized', needsPassword: true, message: 'This book is password protected' });
      return undefined;
    }
    return r;
  };

  const sendFile = async (reply: FastifyReply, path: string, type: string, extra: Record<string, string> = {}) => {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return reply.notFound('File is missing');
    }
    void reply.type(type).header('content-length', String(size));
    for (const [k, v] of Object.entries(extra)) void reply.header(k, v);
    return reply.send(createReadStream(path));
  };

  // The SPA shell; the viewer route inside it fetches book.json.
  app.get('/s/:token', { config: { rateLimit: PUBLIC_RATE } }, async (request, reply) => {
    if (!resolve(request, reply)) return;
    const dist = app.config.webDist;
    if (!dist) return reply.notFound('The web app is not built on this server');
    const html = await readFile(join(dist, 'index.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(html);
  });

  app.post('/s/:token/unlock', { config: { rateLimit: UNLOCK_RATE } }, async (request, reply) => {
    const r = resolve(request, reply);
    if (!r) return;
    const body = UnlockShareInput.safeParse(request.body ?? {});
    if (!body.success) return reply.badRequest('Body must be {"password": string}');
    if (!(await app.shares.verifyPassword(r.share, body.data.password))) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', needsPassword: true, message: 'Wrong password' });
    }
    const exp = Date.now() + SHARE_UNLOCK_TTL_MS;
    void reply.setCookie(shareCookieName(r.share.token), `${r.share.id}.${exp}.${passwordTag(r.share)}`, {
      path: `/s/${r.share.token}`,
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      signed: true,
      maxAge: Math.floor(SHARE_UNLOCK_TTL_MS / 1000),
    });
    return { unlocked: true };
  });

  app.get('/s/:token/book.json', { config: { rateLimit: PUBLIC_RATE } }, async (request, reply): Promise<ViewerBook | undefined> => {
    const r = resolveUnlocked(request, reply);
    if (!r) return;
    const { share, book } = r;
    const format = FORMAT_PRESETS[book.formatId] ?? FORMAT_PRESETS['lulu-square-8.5']!;
    const preview = app.renders.latest(book.id, 'preview');
    const pdf = share.allowDownload ? (app.renders.latest(book.id, 'print') ?? app.renders.latest(book.id, 'proof')) : undefined;
    const placed = new Set(book.pages.flatMap((p) => p.slots.map((s) => s.assetId).filter(Boolean)));
    const dates = dateRangeLabel(app.books.assets(book.id).filter((a) => placed.has(a.id)));
    // The geometry the preview's cover.png was drawn with (Lulu's exact sheet when it was connected), else the estimate.
    const g = preview?.data?.hasCover ? (preview.data.cover?.geometry ?? app.renders.coverFor(book, format)?.geometry) : undefined;
    app.shares.touch(share.id);
    void reply.header('cache-control', 'private, no-store');
    return {
      title: book.title,
      ...(book.subtitle ? { subtitle: book.subtitle } : {}),
      ...(dates ? { dates } : {}),
      chapters: book.chapters.map((c) => ({ title: c.title, ...(c.subtitle ? { subtitle: c.subtitle } : {}), startsAtPage: c.startsAtPage })),
      pageCount: preview?.pageCount ?? 0,
      cover: Boolean(preview?.data?.hasCover),
      ...(g ? { coverFront: { x: g.frontLeftIn / g.widthIn, y: g.wrapIn / g.heightIn, w: format.trimWidthIn / g.widthIn, h: format.trimHeightIn / g.heightIn } } : {}),
      download: Boolean(pdf),
      format: { trimWidthIn: format.trimWidthIn, trimHeightIn: format.trimHeightIn, bleedIn: format.bleedIn },
      version: preview?.id ?? '',
    };
  });

  app.get('/s/:token/pages/:n.png', { config: { rateLimit: PUBLIC_RATE } }, async (request, reply) => {
    const r = resolveUnlocked(request, reply);
    if (!r) return;
    const n = Number((request.params as { n: string }).n);
    const preview = app.renders.latest(r.book.id, 'preview');
    const path = preview && Number.isInteger(n) ? app.renders.previewPagePath(preview.id, n) : undefined;
    if (!path) return reply.notFound('No such page');
    return sendFile(reply, path, 'image/png', { 'cache-control': 'private, max-age=3600' });
  });

  app.get('/s/:token/cover.png', { config: { rateLimit: PUBLIC_RATE } }, async (request, reply) => {
    const r = resolveUnlocked(request, reply);
    if (!r) return;
    const preview = app.renders.latest(r.book.id, 'preview');
    const path = preview ? app.renders.previewCoverPath(preview.id) : undefined;
    if (!path) return reply.notFound('This book has no cover image');
    return sendFile(reply, path, 'image/png', { 'cache-control': 'private, max-age=3600' });
  });

  app.get('/s/:token/pdf', { config: { rateLimit: PUBLIC_RATE } }, async (request, reply) => {
    const r = resolveUnlocked(request, reply);
    if (!r) return;
    if (!r.share.allowDownload) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Downloads are not enabled for this link' });
    const job = app.renders.latest(r.book.id, 'print') ?? app.renders.latest(r.book.id, 'proof');
    const path = job ? app.renders.filePath(job.id) : undefined;
    if (!job || !path) return reply.notFound('No PDF has been rendered for this book yet');
    return sendFile(reply, path, 'application/pdf', {
      'content-disposition': `attachment; filename="${fileSlug(r.book.title)}.pdf"`,
      'cache-control': 'private, no-store',
    });
  });

  /**
   * Print files for Lulu (M5): no auth, the 64-character token is the secret, 410 once expired.
   * Lulu downloads with a non-browser client, so nothing here depends on cookies or headers.
   */
  app.get('/public/exports/:token.pdf', { config: { rateLimit: PUBLIC_RATE } }, async (request, reply) => {
    const token = (request.params as { token?: string }).token ?? '';
    const row = EXPORT_TOKEN_RE.test(token) ? app.exports.byToken(token) : undefined;
    if (!row) return reply.notFound('This export does not exist');
    if (app.exports.isExpired(row)) return gone(reply, 'expired');
    const path = app.exports.filePath(row, (renderId) => app.renders.filePath(renderId));
    if (!path) return reply.notFound('The render behind this export is gone');
    app.exports.countDownload(row.id);
    return sendFile(reply, path, 'application/pdf', { 'content-disposition': `inline; filename="${row.renderId ?? 'probe'}.pdf"`, 'cache-control': 'private, no-store' });
  });

  // Everything else under /public is a 404 (never the SPA).
  const notYet = { statusCode: 404, error: 'Not Found', message: 'Not available' };
  app.get('/public', async (_req, reply) => reply.code(404).send(notYet));
  app.get('/public/*', async (_req, reply) => reply.code(404).send(notYet));
  app.get('/s', async (_req, reply) => reply.code(404).send(notYet));
};

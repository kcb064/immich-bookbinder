import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { ViewerBook } from '@bookbinder/shared';
import { Icon } from '../components/Icon.tsx';

/** What the viewer shows in one step: the front cover, or an opening of one or two pages. */
type View = { kind: 'cover' } | { kind: 'pages'; left: number | undefined; right: number | undefined };

type State =
  | { kind: 'loading' }
  | { kind: 'locked'; error?: string }
  | { kind: 'gone'; reason: 'expired' | 'revoked' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; book: ViewerBook };

const SINGLE_PAGE_QUERY = '(max-width: 719px)';
const SWIPE_PX = 40;

/**
 * Openings of the book, in reading order: the cover first, then page 1 alone on the right, then
 * pairs (2,3), (4,5), ... In single-page mode every page stands alone.
 */
export function viewsFor(pageCount: number, cover: boolean, single: boolean): View[] {
  const out: View[] = [];
  if (cover) out.push({ kind: 'cover' });
  if (pageCount === 0) return out;
  if (single) {
    for (let i = 0; i < pageCount; i++) out.push({ kind: 'pages', left: undefined, right: i });
    return out;
  }
  out.push({ kind: 'pages', left: undefined, right: 0 });
  for (let i = 1; i < pageCount; i += 2) out.push({ kind: 'pages', left: i, right: i + 1 < pageCount ? i + 1 : undefined });
  return out;
}

/** Index of the view that shows `pageIndex`. */
export function viewIndexOfPage(views: readonly View[], pageIndex: number): number {
  const i = views.findIndex((v) => v.kind === 'pages' && (v.left === pageIndex || v.right === pageIndex));
  return i < 0 ? 0 : i;
}

async function fetchBook(token: string): Promise<State> {
  let res: Response;
  try {
    res = await fetch(`/s/${encodeURIComponent(token)}/book.json`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  } catch {
    return { kind: 'error', message: 'Could not reach the server.' };
  }
  if (res.status === 401) return { kind: 'locked' };
  if (res.status === 410) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    return { kind: 'gone', reason: body.reason === 'revoked' ? 'revoked' : 'expired' };
  }
  if (res.status === 404) return { kind: 'missing' };
  if (!res.ok) return { kind: 'error', message: `The server answered ${res.status}.` };
  const parsed = ViewerBook.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) return { kind: 'error', message: 'The server sent something this viewer does not understand.' };
  return { kind: 'ready', book: parsed.data };
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = () => setMatches(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="viewer viewer--centered">
      <div className="viewer__panel">{children}</div>
    </div>
  );
}

function PasswordForm({ token, error, onUnlocked }: { token: string; error?: string | undefined; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(error);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await fetch(`/s/${encodeURIComponent(token)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      if (res.ok) onUnlocked();
      else if (res.status === 429) setMessage('Too many attempts. Wait a minute and try again.');
      else setMessage('That password is not right.');
    } catch {
      setMessage('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      <Icon name="lock" size={28} />
      <h1 className="viewer__h1">This book is password protected</h1>
      <p className="viewer__p">Enter the password you were given with the link.</p>
      <form onSubmit={submit} className="viewer__form">
        <input className="viewer__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoFocus autoComplete="current-password" aria-label="Password" aria-invalid={message ? true : undefined} />
        <button type="submit" className="viewer__btn viewer__btn--primary" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Open the book'}
        </button>
      </form>
      {message ? (
        <p className="viewer__p viewer__p--error" role="alert">
          {message}
        </p>
      ) : null}
    </Centered>
  );
}

/** One page image, cropped to the trim (the PNG carries the bleed). */
function PageImage({ token, version, index, format, width, height, side }: { token: string; version: string; index: number; format: ViewerBook['format']; width: number; height: number; side: 'left' | 'right' }) {
  const bx = (format.bleedIn / format.trimWidthIn) * 100;
  const by = (format.bleedIn / format.trimHeightIn) * 100;
  return (
    <div className={`vpage vpage--${side}`} style={{ width, height }}>
      <img
        src={`/s/${encodeURIComponent(token)}/pages/${index}.png?v=${encodeURIComponent(version)}`}
        alt={`Page ${index + 1}`}
        draggable={false}
        style={{ position: 'absolute', left: `${-bx}%`, top: `${-by}%`, width: `${100 + 2 * bx}%`, height: `${100 + 2 * by}%`, maxWidth: 'none' }}
      />
    </div>
  );
}

function CoverImage({ token, version, book, width, height }: { token: string; version: string; book: ViewerBook; width: number; height: number }) {
  const f = book.coverFront;
  const style = f
    ? { position: 'absolute' as const, left: `${(-f.x / f.w) * 100}%`, top: `${(-f.y / f.h) * 100}%`, width: `${(1 / f.w) * 100}%`, height: `${(1 / f.h) * 100}%`, maxWidth: 'none' }
    : { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'contain' as const };
  return (
    <div className="vpage vpage--cover" style={{ width, height }}>
      <img src={`/s/${encodeURIComponent(token)}/cover.png?v=${encodeURIComponent(version)}`} alt="Cover" draggable={false} style={style} />
    </div>
  );
}

function Reader({ token, book }: { token: string; book: ViewerBook }) {
  const single = useMediaQuery(SINGLE_PAGE_QUERY);
  const views = useMemo(() => viewsFor(book.pageCount, book.cover, single), [book.pageCount, book.cover, single]);
  const [current, setCurrent] = useState(0);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 1000, h: 700 });
  const index = Math.min(current, Math.max(0, views.length - 1));
  const view = views[index];

  useEffect(() => {
    document.title = book.title;
  }, [book.title]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = useCallback((i: number) => setCurrent(Math.max(0, Math.min(views.length - 1, i))), [views.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(index - 1);
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') go(index + 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(views.length - 1);
      else if (e.key === 'Escape') setChaptersOpen(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [go, index, views.length]);

  // Swipe: a horizontal pointer drag of at least SWIPE_PX turns the page.
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const onPointerDown = (e: ReactPointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const start = pointer.current;
    pointer.current = undefined;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  };

  // Lazy-load: only the current view is in the DOM; the next two are fetched ahead into the cache.
  useEffect(() => {
    const urls: string[] = [];
    for (const v of views.slice(index + 1, index + 3)) {
      if (v.kind === 'cover') urls.push(`/s/${encodeURIComponent(token)}/cover.png?v=${encodeURIComponent(book.version)}`);
      else for (const n of [v.left, v.right]) if (n !== undefined) urls.push(`/s/${encodeURIComponent(token)}/pages/${n}.png?v=${encodeURIComponent(book.version)}`);
    }
    const imgs = urls.map((u) => {
      const img = new Image();
      img.src = u;
      return img;
    });
    return () => {
      for (const img of imgs) img.src = '';
    };
  }, [index, views, token, book.version]);

  // Fit one or two trim-sized pages into the stage with some air around them.
  const aspect = book.format.trimWidthIn / book.format.trimHeightIn;
  const pad = single ? 16 : 48;
  const pagesShown = view?.kind === 'pages' && view.left !== undefined && view.right !== undefined ? 2 : 1;
  const pageH = Math.max(120, Math.min(stage.h - 2 * pad, (stage.w - 2 * pad) / (aspect * pagesShown)));
  const pageW = pageH * aspect;

  const counter = (() => {
    if (!view) return '';
    if (view.kind === 'cover') return 'Cover';
    const nums = [view.left, view.right].filter((n): n is number => n !== undefined).map((n) => n + 1);
    return nums.length === 2 ? `Pages ${nums[0]}–${nums[1]} of ${book.pageCount}` : `Page ${nums[0]} of ${book.pageCount}`;
  })();

  const chapterViews = book.chapters.map((c) => ({ ...c, view: viewIndexOfPage(views, c.startsAtPage) }));
  const currentChapter = [...chapterViews].reverse().find((c) => c.view <= index);

  return (
    <div className="viewer">
      <header className="viewer__bar">
        <div className="viewer__title">
          <span className="viewer__name">{book.title}</span>
          {book.subtitle || book.dates ? <span className="viewer__sub">{book.subtitle ?? book.dates}</span> : null}
        </div>
        <div className="viewer__counter" aria-live="polite">
          {counter}
          {currentChapter && view?.kind !== 'cover' ? <span className="viewer__chapter"> · {currentChapter.title}</span> : null}
        </div>
        <div className="viewer__actions">
          {book.chapters.length > 0 ? (
            <button type="button" className={`viewer__btn${chaptersOpen ? ' viewer__btn--on' : ''}`} onClick={() => setChaptersOpen((o) => !o)} aria-expanded={chaptersOpen} aria-controls="viewer-chapters">
              <Icon name="chapter" size={16} />
              <span className="viewer__btn-label">Chapters</span>
            </button>
          ) : null}
          {book.download ? (
            <a className="viewer__btn" href={`/s/${encodeURIComponent(token)}/pdf`} download>
              <Icon name="download" size={16} />
              <span className="viewer__btn-label">PDF</span>
            </a>
          ) : null}
        </div>
      </header>

      <div className="viewer__body">
        <div className="viewer__stage" ref={stageRef} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (pointer.current = undefined)}>
          {views.length === 0 ? (
            <div className="viewer__panel">
              <h1 className="viewer__h1">{book.title}</h1>
              <p className="viewer__p">The pages of this book have not been published yet. Ask whoever sent you the link to render the web preview.</p>
            </div>
          ) : view?.kind === 'cover' ? (
            <div className="vspread">
              <CoverImage token={token} version={book.version} book={book} width={pageW} height={pageH} />
            </div>
          ) : view ? (
            <div className="vspread">
              {view.left !== undefined ? <PageImage token={token} version={book.version} index={view.left} format={book.format} width={pageW} height={pageH} side="left" /> : null}
              {view.right !== undefined ? <PageImage token={token} version={book.version} index={view.right} format={book.format} width={pageW} height={pageH} side="right" /> : null}
            </div>
          ) : null}
          {views.length > 1 ? (
            <>
              <button type="button" className="viewer__nav viewer__nav--prev" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous">
                <Icon name="chevronLeft" size={22} />
              </button>
              <button type="button" className="viewer__nav viewer__nav--next" onClick={() => go(index + 1)} disabled={index >= views.length - 1} aria-label="Next">
                <Icon name="chevronRight" size={22} />
              </button>
            </>
          ) : null}
        </div>
        {chaptersOpen ? (
          <aside className="viewer__drawer" id="viewer-chapters" aria-label="Chapters">
            <div className="viewer__drawer-head">
              <span className="label">Chapters</span>
              <button type="button" className="viewer__btn viewer__btn--icon" onClick={() => setChaptersOpen(false)} aria-label="Close chapters">
                <Icon name="x" size={16} />
              </button>
            </div>
            <ol className="viewer__chapters">
              {book.cover ? (
                <li>
                  <button type="button" className={`viewer__chapter-btn${view?.kind === 'cover' ? ' viewer__chapter-btn--on' : ''}`} onClick={() => go(0)}>
                    <span className="viewer__chapter-title">Cover</span>
                  </button>
                </li>
              ) : null}
              {chapterViews.map((c) => (
                <li key={`${c.startsAtPage}-${c.title}`}>
                  <button type="button" className={`viewer__chapter-btn${currentChapter === c && view?.kind !== 'cover' ? ' viewer__chapter-btn--on' : ''}`} onClick={() => go(c.view)}>
                    <span className="viewer__chapter-title">{c.title}</span>
                    {c.subtitle ? <span className="viewer__chapter-sub">{c.subtitle}</span> : null}
                    <span className="viewer__chapter-page">p. {c.startsAtPage + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>
      {views.length > 1 ? (
        <div className="viewer__progress" aria-hidden="true">
          <div style={{ width: `${((index + 1) / views.length) * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** The public book viewer at /s/:token: no sidebar, no session, only what the share exposes. */
export function ViewerPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const load = useCallback(() => {
    setState({ kind: 'loading' });
    void fetchBook(token).then(setState);
  }, [token]);
  useEffect(load, [load]);
  useEffect(() => {
    document.documentElement.classList.add('viewer-root');
    return () => document.documentElement.classList.remove('viewer-root');
  }, []);

  switch (state.kind) {
    case 'loading':
      return (
        <Centered>
          <p className="viewer__p">Opening the book…</p>
        </Centered>
      );
    case 'locked':
      return <PasswordForm token={token} error={state.error} onUnlocked={load} />;
    case 'gone':
      return (
        <Centered>
          <Icon name="info" size={28} />
          <h1 className="viewer__h1">{state.reason === 'expired' ? 'This link has expired' : 'This link was revoked'}</h1>
          <p className="viewer__p">Ask whoever shared the book with you for a new link.</p>
        </Centered>
      );
    case 'missing':
      return (
        <Centered>
          <Icon name="alert" size={28} />
          <h1 className="viewer__h1">No book here</h1>
          <p className="viewer__p">This link does not point at a shared book. Check that you copied the whole address.</p>
        </Centered>
      );
    case 'error':
      return (
        <Centered>
          <Icon name="alert" size={28} />
          <h1 className="viewer__h1">Something went wrong</h1>
          <p className="viewer__p">{state.message}</p>
          <button type="button" className="viewer__btn" onClick={load}>
            Try again
          </button>
        </Centered>
      );
    case 'ready':
      return <Reader token={token} book={state.book} />;
  }
}

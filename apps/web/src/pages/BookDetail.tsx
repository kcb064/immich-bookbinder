import { memo, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FORMAT_PRESETS, formatIsoRange, targetPhotosFor, type Book, type BookAsset, type SelectionSource } from '@bookbinder/shared';
import { dateRangeLabel, PageView, bookMetaFor, toSpreads } from '@bookbinder/pages';
import { PageHeader } from '../components/Shell.tsx';
import { Button, Chip, LinkButton, Note, Skeleton } from '../components/ui.tsx';
import { RenderButtons, RenderList } from '../components/Renders.tsx';
import { PreflightCard } from '../components/Preflight.tsx';
import { ShareCard } from '../components/Share.tsx';
import { CoverCard } from '../components/CoverCard.tsx';
import { LookCard } from '../components/LookCard.tsx';
import { AiCard } from '../components/AiCard.tsx';
import { OrderSummaryCard } from '../components/OrderCard.tsx';
import { BookCover } from './Dashboard.tsx';
import { isActiveRun, useBook, useBookAssets, useDeleteBook, useInvalidateOnRenderSettle, useLayoutBook, useRenders, useSelection, useSettings } from '../lib/queries.ts';
import { STATUS_LABELS, STATUS_TONES, bindingName, bookPageCount, formatDateTime, formatNumber, formatTrim, pluralize, themeFor } from '../lib/format.ts';
import { errorMessage, isApiError, thumbnailUrl } from '../lib/api.ts';
import { editorImageSrc } from './Editor.tsx';

export function describeSources(book: { rules?: { sources: SelectionSource[] } | undefined }): string {
  const sources = book.rules?.sources ?? [];
  if (sources.length === 0) return 'No sources yet';
  return sources
    .map((s) => {
      switch (s.kind) {
        case 'album':
          return `${s.albumIds.length} album${s.albumIds.length === 1 ? '' : 's'}`;
        case 'people':
          return `${s.personIds.length} ${s.personIds.length === 1 ? 'person' : 'people'}`;
        case 'trip': {
          const where = s.places.length > 0 ? s.places.map((p) => p.name).join(', ') : 'anywhere';
          return `Trip ${formatIsoRange(s.takenAfter, s.takenBefore)} (${where})`;
        }
        case 'smart':
          return `Smart search "${s.query}" (top ${s.limit})`;
        case 'favorites':
          return 'Favorites';
        case 'pet':
          return `Pet ${s.name} ("${s.query}"${s.exampleAssetIds.length > 0 ? `, ${s.exampleAssetIds.length} example${s.exampleAssetIds.length === 1 ? '' : 's'}` : ''})`;
      }
    })
    .join('; ');
}

/** The first few spreads, drawn small with the real page components. Memoised: the page polls renders, selection and jobs every second. */
const SpreadPreview = memo(function SpreadPreview({ book, assets }: { book: Book; assets: BookAsset[] }) {
  const format = FORMAT_PRESETS[book.formatId];
  const theme = themeFor(book);
  if (!format || book.pages.length === 0) return null;
  const map = new Map(assets.map((a) => [a.id, a]));
  const placed = new Set(book.pages.flatMap((p) => p.slots.map((s) => s.assetId).filter(Boolean)));
  const meta = bookMetaFor(book, assets.filter((a) => placed.has(a.id)), placed.size);
  const spreads = toSpreads(book.pages).slice(0, 4);
  const scale = 0.16;
  return (
    <div className="preview-strip" aria-label="First spreads">
      {spreads.map((sp) => (
        <Link key={sp.index} to={`/books/${encodeURIComponent(book.id)}/edit?spread=${sp.index}`} className="preview-spread" title={`Open spread ${sp.index + 1} in the editor`}>
          {sp.left ? (
            <PageView page={sp.left} format={format} theme={theme} assets={map} imageSrc={editorImageSrc('thumbnail')} meta={meta} side="left" scale={scale} />
          ) : (
            <div style={{ width: 840 * scale, flex: 'none' }} />
          )}
          {sp.right ? <PageView page={sp.right} format={format} theme={theme} assets={map} imageSrc={editorImageSrc('thumbnail')} meta={meta} side="right" scale={scale} /> : null}
        </Link>
      ))}
    </div>
  );
});

/** The book document, serialised once per document, not once per poll tick. */
function StoredJson({ book }: { book: Book }) {
  const json = useMemo(() => JSON.stringify(book, null, 2), [book]);
  return (
    <pre className="code" tabIndex={0} style={{ marginTop: 16 }}>
      {json}
    </pre>
  );
}

export function BookDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const book = useBook(id);
  const assets = useBookAssets(id);
  const settings = useSettings();
  const remove = useDeleteBook();
  const layout = useLayoutBook(id ?? '');
  const selection = useSelection(id);
  const renders = useRenders(id);
  useInvalidateOnRenderSettle(id ?? '', renders.data);

  if (book.isPending) {
    return (
      <>
        <PageHeader title={<Skeleton width={180} height={20} />} />
        <div className="content" aria-busy="true">
          <Skeleton height={120} />
        </div>
      </>
    );
  }

  if (book.isError) {
    const notFound = isApiError(book.error) && book.error.status === 404;
    return (
      <>
        <PageHeader title={notFound ? 'Book not found' : 'Book'}>
          <LinkButton to="/" icon="arrowLeft">
            Back to books
          </LinkButton>
        </PageHeader>
        <div className="content content--narrow">
          <Note tone={notFound ? 'amber' : 'error'} role="alert">
            {notFound ? 'This book does not exist or was deleted.' : `Could not load this book: ${errorMessage(book.error)}`}
          </Note>
        </div>
      </>
    );
  }

  const b = book.data;
  const theme = themeFor(b);
  const format = FORMAT_PRESETS[b.formatId];
  const hasPages = b.pages.length > 0;
  const luluFormat = format?.vendor === 'lulu';
  const immichReady = Boolean(settings.data?.immich.url && settings.data.immich.apiKeySet);
  const photoList = assets.data ?? [];
  const placedCount = new Set(b.pages.flatMap((p) => p.slots.map((s) => s.assetId).filter(Boolean))).size;
  const summary = selection.data?.summary;
  const hasSelection = Boolean(summary && summary.total > 0);
  const selecting = isActiveRun(selection.data?.run);
  const reviewHref = `/books/${encodeURIComponent(b.id)}/review`;

  const onDelete = () => {
    if (!window.confirm(`Delete "${b.title}"? This cannot be undone.`)) return;
    remove.mutate(b.id, { onSuccess: () => navigate('/', { replace: true }) });
  };

  const runLayout = (refetch: boolean) => {
    if (hasPages && !window.confirm('Lay the book out again? Your page edits will be replaced by a fresh automatic layout.')) return;
    layout.mutate({ refetch });
  };

  return (
    <>
      <PageHeader
        title={
          <span className="row">
            <Link to="/" className="muted" aria-label="Back to books" style={{ display: 'inline-flex' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5M11 18l-6-6 6-6" />
              </svg>
            </Link>
            {b.title}
            <Chip tone={STATUS_TONES[b.status]}>{STATUS_LABELS[b.status]}</Chip>
          </span>
        }
      >
        <Button icon="trash" variant="danger" onClick={onDelete} loading={remove.isPending}>
          Delete
        </Button>
        {hasSelection || selecting ? (
          <LinkButton to={reviewHref} icon="sparkles" variant={hasPages ? 'default' : hasSelection ? 'default' : 'primary'}>
            Review picks
          </LinkButton>
        ) : null}
        {hasPages ? (
          <Button icon="layout" onClick={() => runLayout(false)} loading={layout.isPending} title="Automatic layout again from the current picks">
            Re-lay out
          </Button>
        ) : null}
        {hasPages ? (
          <LinkButton to={`/books/${encodeURIComponent(b.id)}/edit`} variant="primary" icon="edit">
            Open editor
          </LinkButton>
        ) : hasSelection ? (
          <Button variant="primary" icon="layout" onClick={() => runLayout(false)} loading={layout.isPending} disabled={!immichReady || (summary?.picked ?? 0) === 0} title={immichReady ? undefined : 'Connect Immich in Settings first'}>
            Lay out pages
          </Button>
        ) : (
          <LinkButton to={reviewHref} variant="primary" icon="sparkles">
            Select photos
          </LinkButton>
        )}
      </PageHeader>

      <div className="content">
        {remove.isError ? (
          <Note tone="error" role="alert">
            Could not delete: {errorMessage(remove.error)}
          </Note>
        ) : null}
        {layout.isError ? (
          <Note tone="error" role="alert">
            Layout failed: {errorMessage(layout.error)}
          </Note>
        ) : null}
        {layout.isSuccess && layout.data.warnings.length > 0 ? (
          <Note tone="amber">
            <div className="stack" style={{ gap: 4 }}>
              {layout.data.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          </Note>
        ) : null}
        {!hasPages && !layout.isPending ? (
          <Note tone="accent">
            {!immichReady ? (
              <>
                <Link to="/settings">Connect Immich in Settings</Link> before selecting photos for this book.
              </>
            ) : selecting ? (
              <>
                Photos are being scored right now. <Link to={reviewHref}>Watch the progress on the review page</Link>.
              </>
            ) : hasSelection ? (
              <>
                {formatNumber(summary?.picked)} of {formatNumber(summary?.total)} photos are picked. <Link to={reviewHref}>Review the picks</Link>, then <strong>Lay out pages</strong> places them
                in date order on the template library.
              </>
            ) : (
              <>
                Nothing is selected yet. <strong>Select photos</strong> pulls the photos from Immich, scores every one for sharpness, exposure, people and composition, collapses
                bursts and picks about {formatNumber(targetPhotosFor(b.rules?.targetPages ?? 48))} for a {b.rules?.targetPages ?? 48}-page book (fewer when it gets chapters). Every pick is explained and
                reversible.
              </>
            )}
          </Note>
        ) : null}
        {layout.isPending ? (
          <Note tone="accent" role="status">
            Fetching photos from Immich and laying out pages…
          </Note>
        ) : null}

        {hasPages ? (
          <section className="stack" style={{ gap: 12 }}>
            <div className="row row--between">
              <div className="label">Spreads</div>
              <Link to={`/books/${encodeURIComponent(b.id)}/edit`} className="small">
                Open all {b.pages.length} pages in the editor
              </Link>
            </div>
            <SpreadPreview book={b} assets={photoList} />
          </section>
        ) : null}

        <div className="detail">
          <div className="stack" style={{ gap: 24 }}>
            <PreflightCard bookId={b.id} enabled={hasPages} />

            <section className="card card--pad stack">
              <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                <h2 className="h2">PDFs and previews</h2>
                <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
                  <RenderButtons
                    bookId={b.id}
                    size="sm"
                    kinds={luluFormat ? ['proof', 'print', 'cover', 'preview'] : ['proof', 'print', 'preview']}
                    disabled={!hasPages || !immichReady}
                    disabledReason={!hasPages ? 'Lay out the book first' : !immichReady ? 'Connect Immich first' : undefined}
                  />
                </div>
              </div>
              <RenderList bookId={b.id} />
            </section>

            <LookCard book={b} />

            <AiCard book={b} disabled={!hasPages} />

            <ShareCard book={b} disabled={!hasPages} />

            {luluFormat ? <OrderSummaryCard book={b} disabled={!hasPages} /> : null}

            <section className="card card--pad stack">
              <h2 className="h2">Overview</h2>
              <dl className="kv">
                <dt>Title</dt>
                <dd>{b.title}</dd>
                {b.subtitle ? (
                  <>
                    <dt>Subtitle</dt>
                    <dd>{b.subtitle}</dd>
                  </>
                ) : null}
                <dt>Status</dt>
                <dd>{STATUS_LABELS[b.status]}</dd>
                <dt>Format</dt>
                <dd>
                  {format?.name ?? b.formatId} <span className="muted">({formatTrim(b.formatId)})</span>
                </dd>
                <dt>Binding</dt>
                <dd>
                  {bindingName(b.luluProduct.binding, b.formatId)}{' '}
                  <span className="muted mono small">
                    {b.luluProduct.binding} · {b.luluProduct.paper} · {b.luluProduct.finish} · {b.luluProduct.quality}
                  </span>
                </dd>
                <dt>Theme</dt>
                <dd>{theme.name}</dd>
                <dt>Pages</dt>
                <dd>
                  {bookPageCount(b)} {b.pages.length === 0 ? <span className="muted">(target; nothing laid out yet)</span> : null}
                </dd>
                <dt>Photos</dt>
                <dd>
                  {photoList.length > 0 ? (
                    <>
                      {formatNumber(placedCount)} placed of {pluralize(photoList.length, 'photo')}
                      {photoList.length ? <span className="muted"> · {dateRangeLabel(photoList)}</span> : null}
                    </>
                  ) : (
                    <span className="muted">not fetched yet</span>
                  )}
                </dd>
                <dt>Sources</dt>
                <dd>{describeSources(b)}</dd>
                <dt>Chapters</dt>
                <dd>
                  {b.chapters.length > 0 ? (
                    b.chapters.map((c) => c.title).join(' · ')
                  ) : hasPages ? (
                    <span className="muted">none (one place, or chapters turned off)</span>
                  ) : (
                    <span className="muted">decided at layout from the photos' places</span>
                  )}
                </dd>
                <dt>Selection</dt>
                <dd>
                  {summary ? (
                    <>
                      {formatNumber(summary.picked)} picked · {formatNumber(summary.alternates)} alternates · {formatNumber(summary.rejected)} rejected{' '}
                      <Link to={reviewHref} className="small">
                        Review
                      </Link>
                    </>
                  ) : selecting ? (
                    <span className="muted">running…</span>
                  ) : (
                    <span className="muted">not run yet</span>
                  )}
                </dd>
                <dt>Created</dt>
                <dd>{formatDateTime(b.createdAt)}</dd>
                <dt>Updated</dt>
                <dd>{formatDateTime(b.updatedAt)}</dd>
                <dt>ID</dt>
                <dd className="mono small">{b.id}</dd>
              </dl>
            </section>

            {photoList.length > 0 ? (
              <section className="card card--pad stack">
                <div className="row row--between">
                  <h2 className="h2">Photos</h2>
                  <LinkButton size="sm" variant="ghost" icon="sparkles" to={reviewHref}>
                    Review picks
                  </LinkButton>
                </div>
                <div className="thumb-grid">
                  {photoList.slice(0, 40).map((a) => (
                    <img key={a.id} src={thumbnailUrl(a.id)} alt={a.fileName ?? ''} loading="lazy" title={a.fileName} />
                  ))}
                  {photoList.length > 40 ? <div className="thumb-grid__more muted small">+{formatNumber(photoList.length - 40)}</div> : null}
                </div>
              </section>
            ) : null}

            <details className="card card--pad">
              <summary className="h2" style={{ cursor: 'pointer' }}>
                Stored JSON
              </summary>
              <StoredJson book={b} />
            </details>
          </div>

          <aside className="stack">
            {hasPages && luluFormat ? (
              <CoverCard book={b} assets={photoList} />
            ) : (
              <>
                <BookCover book={b} className="detail__cover" />
                <CoverCard book={b} assets={photoList} />
              </>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

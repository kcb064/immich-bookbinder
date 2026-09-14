import { Link, useNavigate, useParams } from 'react-router';
import { FORMAT_PRESETS, THEMES, type Book, type BookAsset } from '@bookbinder/shared';
import { dateRangeLabel, PageView, bookMetaFor, toSpreads } from '@bookbinder/pages';
import { PageHeader } from '../components/Shell.tsx';
import { Button, Chip, LinkButton, Note, Skeleton } from '../components/ui.tsx';
import { RenderButtons, RenderList } from '../components/Renders.tsx';
import { BookCover } from './Dashboard.tsx';
import { useBook, useBookAssets, useDeleteBook, useLayoutBook, useSettings } from '../lib/queries.ts';
import { STATUS_LABELS, STATUS_TONES, bindingName, bookPageCount, formatDateTime, formatNumber, formatTrim, pluralize, themeFor } from '../lib/format.ts';
import { errorMessage, isApiError, thumbnailUrl } from '../lib/api.ts';
import { editorImageSrc } from './Editor.tsx';

function describeSources(book: { rules?: { sources: Array<{ kind: string } & Record<string, unknown>> } | undefined }): string {
  const sources = book.rules?.sources ?? [];
  if (sources.length === 0) return 'No sources yet';
  return sources
    .map((s) => {
      switch (s.kind) {
        case 'album': {
          const ids = s['albumIds'];
          const n = Array.isArray(ids) ? ids.length : 0;
          return `${n} album${n === 1 ? '' : 's'}`;
        }
        case 'people': {
          const ids = s['personIds'];
          const n = Array.isArray(ids) ? ids.length : 0;
          return `${n} ${n === 1 ? 'person' : 'people'}`;
        }
        case 'trip':
          return 'Trip';
        case 'smart':
          return `Smart search "${String(s['query'] ?? '')}"`;
        case 'favorites':
          return 'Favorites';
        default:
          return s.kind;
      }
    })
    .join(', ');
}

/** The first few spreads, drawn small with the real page components. */
function SpreadPreview({ book, assets }: { book: Book; assets: BookAsset[] }) {
  const format = FORMAT_PRESETS[book.formatId];
  const theme = THEMES[book.themeId] ?? themeFor(book.themeId);
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
}

export function BookDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const book = useBook(id);
  const assets = useBookAssets(id);
  const settings = useSettings();
  const remove = useDeleteBook();
  const layout = useLayoutBook(id ?? '');

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
  const theme = themeFor(b.themeId);
  const format = FORMAT_PRESETS[b.formatId];
  const hasPages = b.pages.length > 0;
  const immichReady = Boolean(settings.data?.immich.url && settings.data.immich.apiKeySet);
  const photoList = assets.data ?? [];
  const placedCount = new Set(b.pages.flatMap((p) => p.slots.map((s) => s.assetId).filter(Boolean))).size;

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
        {hasPages ? (
          <Button icon="layout" onClick={() => runLayout(false)} loading={layout.isPending} title="Automatic layout again from the stored photo list">
            Re-lay out
          </Button>
        ) : null}
        {hasPages ? (
          <LinkButton to={`/books/${encodeURIComponent(b.id)}/edit`} variant="primary" icon="edit">
            Open editor
          </LinkButton>
        ) : (
          <Button variant="primary" icon="layout" onClick={() => runLayout(true)} loading={layout.isPending} disabled={!immichReady} title={immichReady ? undefined : 'Connect Immich in Settings first'}>
            Fetch photos & lay out
          </Button>
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
            {immichReady ? (
              <>
                Nothing is laid out yet. <strong>Fetch photos &amp; lay out</strong> pulls the album{(b.rules?.sources.length ?? 0) > 1 ? 's' : ''} from Immich and places every photo in date order on the
                template library. You can then swap, remove and reorder in the editor.
              </>
            ) : (
              <>
                <Link to="/settings">Connect Immich in Settings</Link> before laying out this book.
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
            <section className="card card--pad stack">
              <div className="row row--between">
                <h2 className="h2">PDFs</h2>
                <div className="row">
                  <RenderButtons bookId={b.id} size="sm" disabled={!hasPages || !immichReady} disabledReason={!hasPages ? 'Lay out the book first' : !immichReady ? 'Connect Immich first' : undefined} />
                </div>
              </div>
              <RenderList bookId={b.id} />
            </section>

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
                  <Button size="sm" variant="ghost" icon="refresh" onClick={() => runLayout(true)} loading={layout.isPending} title="Fetch the album again from Immich and lay out afresh">
                    Refetch from Immich
                  </Button>
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
              <pre className="code" tabIndex={0} style={{ marginTop: 16 }}>
                {JSON.stringify(b, null, 2)}
              </pre>
            </details>
          </div>

          <aside className="stack">
            <BookCover book={b} className="detail__cover" />
            <div className="muted small" style={{ lineHeight: 1.5 }}>
              Cover placeholder using the {theme.name} paper color. The real cover is designed in a later milestone.
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

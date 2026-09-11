import { Link, useNavigate, useParams } from 'react-router';
import { FORMAT_PRESETS } from '@bookbinder/shared';
import { PageHeader } from '../components/Shell.tsx';
import { Button, Chip, LinkButton, Note, Skeleton } from '../components/ui.tsx';
import { BookCover } from './Dashboard.tsx';
import { useBook, useDeleteBook } from '../lib/queries.ts';
import { STATUS_LABELS, STATUS_TONES, bindingName, bookPageCount, formatDateTime, formatTrim, themeFor } from '../lib/format.ts';
import { errorMessage, isApiError } from '../lib/api.ts';

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

export function BookDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const book = useBook(id);
  const remove = useDeleteBook();

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

  const onDelete = () => {
    if (!window.confirm(`Delete "${b.title}"? This cannot be undone.`)) return;
    remove.mutate(b.id, { onSuccess: () => navigate('/', { replace: true }) });
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
        <Button variant="primary" iconRight="chevronRight" disabled title="The editor arrives in a later milestone">
          Open editor
        </Button>
      </PageHeader>

      <div className="content">
        {remove.isError ? (
          <Note tone="error" role="alert">
            Could not delete: {errorMessage(remove.error)}
          </Note>
        ) : null}
        <Note tone="accent">
          Selection and layout are not built yet. This page shows what is stored for the book; the editor comes in a later
          milestone.
        </Note>
        <div className="detail">
          <div className="stack" style={{ gap: 24 }}>
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
                <dt>Chapters</dt>
                <dd>{b.chapters.length}</dd>
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

            <section className="card card--pad stack">
              <h2 className="h2">Stored JSON</h2>
              <pre className="code" tabIndex={0}>
                {JSON.stringify(b, null, 2)}
              </pre>
            </section>
          </div>

          <aside className="stack">
            <BookCover book={b} className="detail__cover" />
            <div className="muted small" style={{ lineHeight: 1.5 }}>
              Cover placeholder using the {theme.name} paper color. The real cover is designed in the editor.
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

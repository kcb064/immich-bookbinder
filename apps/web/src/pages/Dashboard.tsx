import { Link } from 'react-router';
import type { ThemeOverrides } from '@bookbinder/shared';
import { PageHeader } from '../components/Shell.tsx';
import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { Chip, LinkButton, Note, Skeleton } from '../components/ui.tsx';
import { useBooks } from '../lib/queries.ts';
import type { BookSummary } from '../lib/queries.ts';
import { STATUS_LABELS, STATUS_TONES, bookMeta, themeFor } from '../lib/format.ts';
import { errorMessage } from '../lib/api.ts';

export function BookCover({ book, className }: { book: { title: string; themeId: string; themeOverrides?: ThemeOverrides | undefined }; className?: string }) {
  const theme = themeFor(book);
  // Serif display themes set titles in italic; sans themes use small tracked caps (see the design canvas).
  const serif = /serif/i.test(theme.displayFont) && !/sans-serif/i.test(theme.displayFont);
  return (
    <div className={className ?? 'book-cover'} style={{ background: theme.paper, color: theme.ink }} aria-hidden="true">
      <span className="book-cover__spine" />
      <div
        className="book-cover__title"
        style={
          serif
            ? { fontFamily: theme.displayFont }
            : { fontFamily: theme.displayFont, fontStyle: 'normal', fontSize: '0.5em', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600 }
        }
      >
        {book.title}
      </div>
    </div>
  );
}

function BookCard({ book }: { book: BookSummary }) {
  return (
    <Link to={`/books/${encodeURIComponent(book.id)}`} className="card book-card" aria-label={`${book.title}, ${STATUS_LABELS[book.status]}`}>
      <BookCover book={book} />
      <div className="book-card__body">
        <div className="book-card__title-row">
          <div className="book-card__title">{book.title}</div>
          <Chip tone={STATUS_TONES[book.status]}>{STATUS_LABELS[book.status]}</Chip>
        </div>
        <div className="book-card__meta">{bookMeta({ formatId: book.formatId, pageCount: book.pageCount })}</div>
      </div>
    </Link>
  );
}

const WAYS: Array<{ icon: IconName; name: string; desc: string; soon?: boolean }> = [
  { icon: 'album', name: 'Album', desc: 'Pick one or more Immich albums. The app scores the photos and lays out a first draft.' },
  { icon: 'trip', name: 'Trip', desc: 'A date range and the places you were. Finds photos that never made it into an album.', soon: true },
  { icon: 'people', name: 'People & pets', desc: 'Everything with chosen people, or a pet you have taught the app to find.', soon: true },
];

function EmptyState() {
  return (
    <div className="card empty">
      <div className="stack" style={{ gap: 8 }}>
        <h2 className="empty__title">Make your first book</h2>
        <p className="muted" style={{ margin: 0, maxWidth: 560, lineHeight: 1.5 }}>
          Bookbinder pulls photos from your Immich library, picks the keepers, and lays them out as a print-ready book. Start from
          one of three sources:
        </p>
      </div>
      <div className="empty__ways">
        {WAYS.map((w) => (
          <div key={w.name} className="way">
            <div className="way__icon">
              <Icon name={w.icon} />
            </div>
            <div className="way__name">
              {w.name}
              {w.soon ? <Chip>coming in M3</Chip> : null}
            </div>
            <div className="way__desc">{w.desc}</div>
          </div>
        ))}
      </div>
      <div className="row">
        <LinkButton to="/new" variant="primary" icon="plus">
          New book
        </LinkButton>
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="book-grid" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card book-card">
          <Skeleton height="auto" className="book-cover" />
          <div className="book-card__body">
            <Skeleton width="70%" />
            <Skeleton width="50%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const books = useBooks();

  return (
    <>
      <PageHeader title="Books">
        <LinkButton to="/new" variant="primary" icon="plus">
          New book
        </LinkButton>
      </PageHeader>
      <div className="content">
        {books.isPending ? (
          <section className="stack" aria-busy="true">
            <div className="label">Your books</div>
            <GridSkeleton />
          </section>
        ) : books.isError ? (
          <Note tone="error" role="alert">
            Could not load your books: {errorMessage(books.error)}
          </Note>
        ) : books.data.length === 0 ? (
          <EmptyState />
        ) : (
          <section className="stack" style={{ gap: 14 }}>
            <div className="label">Your books</div>
            <div className="book-grid">
              {books.data.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

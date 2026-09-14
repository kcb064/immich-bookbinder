import { Link } from 'react-router';
import type { PreflightItem } from '@bookbinder/shared';
import { Chip, Note, Skeleton } from './ui.tsx';
import { Icon } from './Icon.tsx';
import { usePreflight } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';

/** Where an item points: the editor spread holding the page, or nothing for book-level items. */
function itemHref(bookId: string, item: PreflightItem): string | undefined {
  if (item.pageIndex === undefined) return undefined;
  return `/books/${encodeURIComponent(bookId)}/edit?page=${item.pageIndex}`;
}

/** "Print readiness" card: the preflight checks with links into the editor. */
export function PreflightCard({ bookId, enabled }: { bookId: string; enabled: boolean }) {
  const preflight = usePreflight(bookId, enabled);
  if (!enabled) {
    return (
      <section className="card card--pad stack">
        <h2 className="h2">Print readiness</h2>
        <div className="muted small">Lay out the book to check page count, resolution, captions and the cover.</div>
      </section>
    );
  }
  const p = preflight.data;
  const errors = p?.items.filter((i) => i.level === 'error').length ?? 0;
  const warns = p?.items.filter((i) => i.level === 'warn').length ?? 0;
  return (
    <section className="card card--pad stack">
      <div className="row row--between">
        <h2 className="h2">Print readiness</h2>
        {p ? (
          <Chip tone={errors > 0 ? 'red' : warns > 0 ? 'amber' : 'green'} icon={errors > 0 ? 'alert' : warns > 0 ? 'info' : 'check'}>
            {errors > 0 ? `${errors} to fix` : warns > 0 ? `${warns} to check` : 'Ready to print'}
          </Chip>
        ) : null}
      </div>
      {preflight.isPending ? <Skeleton height={40} /> : null}
      {preflight.isError ? (
        <Note tone="error" role="alert">
          Could not run the checks: {errorMessage(preflight.error)}
        </Note>
      ) : null}
      {p && p.items.length === 0 ? <div className="muted small">Page count, resolution, captions, cover and print PDF all check out.</div> : null}
      {p && p.items.length > 0 ? (
        <ul className="preflight">
          {p.items.map((item, i) => {
            const href = itemHref(bookId, item);
            return (
              <li key={`${item.code}-${item.pageIndex ?? ''}-${item.slotId ?? ''}-${i}`} className={`preflight__item preflight__item--${item.level}`}>
                <Icon name={item.level === 'error' ? 'alert' : 'info'} size={16} />
                <div className="grow">
                  {item.message}
                  {href ? (
                    <>
                      {' '}
                      <Link to={href} className="small">
                        Open page {item.pageIndex! + 1}
                      </Link>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

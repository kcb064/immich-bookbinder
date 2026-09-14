import { Link } from 'react-router';
import { PageHeader } from '../components/Shell.tsx';
import { Chip, Note, Skeleton } from '../components/ui.tsx';
import { useAllOrders, useBooks } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatDateTime, formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '../lib/format.ts';

/** Every Lulu order across books, newest first; each row opens the book's order page. */
export function OrdersPage() {
  const orders = useAllOrders();
  const books = useBooks();
  const titles = new Map((books.data ?? []).map((b) => [b.id, b.title]));
  return (
    <>
      <PageHeader title="Orders" />
      <div className="content content--narrow">
        {orders.isPending ? <Skeleton height={80} /> : null}
        {orders.isError ? (
          <Note tone="error" role="alert">
            Could not load orders: {errorMessage(orders.error)}
          </Note>
        ) : null}
        {orders.data && orders.data.length === 0 ? (
          <Note tone="neutral">
            No orders yet. Open a laid-out book and choose <strong>Order printed copies</strong>; sandbox orders show up here too.
          </Note>
        ) : null}
        {orders.data && orders.data.length > 0 ? (
          <ul className="shares">
            {orders.data.map((o) => (
              <li key={o.id} className="share">
                <div className="row row--between" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <Chip tone={ORDER_STATUS_TONES[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Chip>
                    <Chip outline>{o.env}</Chip>
                  </div>
                  <span className="muted small">{formatDateTime(o.updatedAt)}</span>
                </div>
                <div>
                  <Link to={`/books/${encodeURIComponent(o.bookId)}/order`}>{titles.get(o.bookId) ?? 'Deleted book'}</Link>
                  <span className="muted">
                    {' '}
                    · {o.quantity} {o.quantity === 1 ? 'copy' : 'copies'} to {o.shippingAddress.name}, {o.shippingAddress.city} {o.shippingAddress.country_code}
                    {o.cost ? ` · ${formatMoney(o.cost.totalInclTax, o.cost.currency)}` : ''}
                    {o.luluJobId ? ` · Lulu job ${o.luluJobId}` : ''}
                  </span>
                </div>
                {o.error ? <div className="small" style={{ color: 'var(--red)' }}>{o.error}</div> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

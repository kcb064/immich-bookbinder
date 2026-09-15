import { useState } from 'react';
import { Link } from 'react-router';
import { SHIPPING_LEVEL_LABELS, type Book, type OrderView } from '@bookbinder/shared';
import { Button, Chip, LinkButton, Note } from './ui.tsx';
import { Icon } from './Icon.tsx';
import { useOrders, useRefreshOrder, useSettings, useSubmitOrder } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatDate, formatDateTime, formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '../lib/format.ts';

/** The order's path so far, in the order it happens; the current step is highlighted. */
const STEPS: Array<{ key: string; label: string; statuses: OrderView['status'][] }> = [
  { key: 'validate', label: 'Files validated', statuses: ['validating'] },
  { key: 'quote', label: 'Quoted', statuses: ['quoted'] },
  { key: 'submit', label: 'Print job created', statuses: ['submitted'] },
  { key: 'pay', label: 'Paid on lulu.com', statuses: ['unpaid'] },
  { key: 'production', label: 'In production', statuses: ['in-production'] },
  { key: 'shipped', label: 'Shipped', statuses: ['shipped'] },
];
const ORDER_OF: Record<OrderView['status'], number> = {
  draft: 0,
  validating: 0,
  quoted: 1,
  submitted: 2,
  unpaid: 3,
  'in-production': 4,
  shipped: 5,
  rejected: -1,
  error: -1,
  canceled: -1,
};

function Timeline({ order }: { order: OrderView }) {
  const at = ORDER_OF[order.status];
  const dead = at < 0;
  // A dead order stopped after the last step it reached: infer it from the job id and cost.
  const reached = dead ? (order.luluJobId ? (order.luluStatus === 'REJECTED' || order.luluStatus === 'ERROR' ? 2 : 3) : order.cost ? 1 : 0) : at;
  return (
    <ol className="timeline" aria-label="Order progress">
      {STEPS.map((s, i) => {
        const state = dead && i === reached ? 'dead' : i < reached || (!dead && i < at) ? 'done' : i === at && !dead ? 'current' : 'todo';
        return (
          <li key={s.key} className={`timeline__step timeline__step--${state}`}>
            <span className="timeline__dot" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={11} strokeWidth={2.6} /> : state === 'dead' ? <Icon name="x" size={11} strokeWidth={2.6} /> : null}
            </span>
            <span className="timeline__label">{state === 'dead' ? ORDER_STATUS_LABELS[order.status] : s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CostTable({ order }: { order: OrderView }) {
  const c = order.cost;
  if (!c) return null;
  const m = (v: string | undefined) => formatMoney(v, c.currency);
  return (
    <table className="cost">
      <tbody>
        {c.lineItems.map((li, i) => (
          <tr key={i}>
            <td>
              {li.quantity} × {order.lineItems[i]?.title ?? 'book'}, {order.lineItems[i]?.pageCount ?? order.pageCount} pages <span className="muted">({m(li.unitCost)} each)</span>
            </td>
            <td className="mono">{m(li.totalExclTax)}</td>
          </tr>
        ))}
        {c.lineItems.flatMap((li) => li.discounts).map((d, i) => (
          <tr key={`d${i}`}>
            <td className="muted">{d.description}</td>
            <td className="mono">−{m(d.amount)}</td>
          </tr>
        ))}
        <tr>
          <td>Shipping ({SHIPPING_LEVEL_LABELS[order.shippingLevel]})</td>
          <td className="mono">{m(c.shipping.exclTax)}</td>
        </tr>
        {c.fulfillment && Number(c.fulfillment.exclTax) > 0 ? (
          <tr>
            <td>Fulfillment</td>
            <td className="mono">{m(c.fulfillment.exclTax)}</td>
          </tr>
        ) : null}
        {c.fees.map((f, i) => (
          <tr key={`f${i}`}>
            <td>{f.type}</td>
            <td className="mono">{m(f.exclTax)}</td>
          </tr>
        ))}
        <tr>
          <td>Tax</td>
          <td className="mono">{m(c.totalTax)}</td>
        </tr>
        <tr className="cost__total">
          <td>Total</td>
          <td className="mono">{m(c.totalInclTax)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** One order: status, timeline, quote, actions (place, refresh, cancel), Lulu links and the message log. */
export function OrderCard({ order, expanded = false, onCancel }: { order: OrderView; expanded?: boolean; onCancel?: (() => void) | undefined }) {
  const submit = useSubmitOrder(order.bookId);
  const refresh = useRefreshOrder(order.bookId);
  const [open, setOpen] = useState(expanded);
  const a = order.shippingAddress;
  const cancelable = order.status === 'quoted' || order.status === 'unpaid' || order.status === 'submitted' || order.status === 'validating' || order.status === 'error' || order.status === 'rejected';
  const exportsExpired = order.exports ? new Date(order.exports.expiresAt).getTime() < Date.now() : false;

  const onPlace = () => {
    const total = order.cost ? formatMoney(order.cost.totalInclTax, order.cost.currency) : 'the quoted amount';
    if (!window.confirm(`Create the print job at Lulu (${order.env}) for ${total}? You then pay it on lulu.com.`)) return;
    submit.mutate(order.id);
  };

  return (
    <article className={`order${open ? ' order--open' : ''}`}>
      <button type="button" className="order__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Chip tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Chip>
        <span className="grow">
          {order.lineItems.length > 1 ? `${order.lineItems.reduce((n, li) => n + li.quantity, 0)} copies of ${order.lineItems.length} books` : `${order.quantity} ${order.quantity === 1 ? 'copy' : 'copies'}`} to {a.name}, {a.city} {a.country_code}
          {order.imported ? <span className="muted"> · imported from Lulu</span> : null}
          {order.cost ? <span className="muted"> · {formatMoney(order.cost.totalInclTax, order.cost.currency)}</span> : null}
        </span>
        <span className="muted small">
          {order.luluJobId ? `Lulu job ${order.luluJobId} · ` : ''}
          {formatDateTime(order.createdAt)}
        </span>
        <Icon name={open ? 'chevronLeft' : 'chevronRight'} size={16} />
      </button>
      {open ? (
        <div className="order__body stack">
          <Timeline order={order} />
          {order.error ? (
            <Note tone="error" role="alert">
              {order.error}
            </Note>
          ) : null}
          {order.status === 'validating' ? (
            <Note tone="accent" role="status">
              Lulu is downloading and checking the interior and cover PDFs. This takes up to a few minutes; the page refreshes on its own.
            </Note>
          ) : null}
          {order.status === 'unpaid' || order.status === 'submitted' ? (
            <Note tone="amber">
              The print job is created and waits for payment. Pay it in your Lulu {order.env} account; the app never handles card details. Production starts after payment.
            </Note>
          ) : null}
          <CostTable order={order} />
          {order.tracking.length > 0 ? (
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {order.tracking.map((tr) => (
                <a key={tr.url} className="btn btn--sm" href={tr.url} target="_blank" rel="noreferrer">
                  <Icon name="external" size={14} />
                  Track {tr.carrier ? `(${tr.carrier})` : 'parcel'}
                </a>
              ))}
            </div>
          ) : null}
          <div className="actions">
            {order.status === 'quoted' ? (
              <Button variant="primary" icon="printer" onClick={onPlace} loading={submit.isPending} disabled={exportsExpired} title={exportsExpired ? 'The export links expired; quote again' : undefined}>
                Place order
              </Button>
            ) : null}
            {order.payUrl && (order.status === 'unpaid' || order.status === 'submitted') ? (
              <a className="btn btn--primary" href={order.payUrl} target="_blank" rel="noreferrer">
                <Icon name="external" size={16} />
                Pay on lulu.com
              </a>
            ) : null}
            {order.luluJobId && order.status !== 'canceled' ? (
              <Button icon="refresh" onClick={() => refresh.mutate(order.id)} loading={refresh.isPending}>
                Refresh status
              </Button>
            ) : null}
            {cancelable && onCancel ? (
              <Button
                variant="danger"
                icon="x"
                onClick={() => {
                  if (window.confirm(order.luluJobId ? `Ask Lulu to cancel print job ${order.luluJobId}?` : 'Cancel this quote?')) onCancel();
                }}
                style={{ marginLeft: 'auto' }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          {submit.isError ? (
            <Note tone="error" role="alert">
              {errorMessage(submit.error)}
            </Note>
          ) : null}
          {refresh.isError ? (
            <Note tone="error" role="alert">
              {errorMessage(refresh.error)}
            </Note>
          ) : null}
          <dl className="kv">
            <dt>Product</dt>
            <dd className="mono small">{order.podPackageId}</dd>
            <dt>Ship to</dt>
            <dd>
              {a.name}, {a.street1}
              {a.street2 ? `, ${a.street2}` : ''}, {a.city}
              {a.state_code ? ` ${a.state_code}` : ''} {a.postcode}, {a.country_code} · {a.phone_number}
            </dd>
            <dt>Shipping</dt>
            <dd>{SHIPPING_LEVEL_LABELS[order.shippingLevel]}</dd>
            {order.luluStatus ? (
              <>
                <dt>Lulu status</dt>
                <dd className="mono small">{order.luluStatus}</dd>
              </>
            ) : null}
            {order.exports ? (
              <>
                <dt>PDF links</dt>
                <dd className="small">
                  <a href={order.exports.interior} target="_blank" rel="noreferrer">
                    interior
                  </a>{' '}
                  ·{' '}
                  <a href={order.exports.cover} target="_blank" rel="noreferrer">
                    cover
                  </a>{' '}
                  <span className="muted">
                    {exportsExpired ? 'expired' : 'expire'} {formatDate(order.exports.expiresAt)}
                  </span>
                </dd>
              </>
            ) : null}
            <dt>Reference</dt>
            <dd className="mono small">{order.externalId}</dd>
          </dl>
          {order.messages.length > 0 ? (
            <ol className="orderlog">
              {order.messages.map((m, i) => (
                <li key={i} className={`orderlog__item orderlog__item--${m.level}`}>
                  <span className="muted small mono">{formatDateTime(m.at)}</span>
                  <span className="small">
                    <span className="muted">{m.source === 'lulu' ? 'Lulu: ' : ''}</span>
                    {m.text}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** "Order" card on the book page: the newest order's state and the way to the order page. */
export function OrderSummaryCard({ book, disabled }: { book: Book; disabled?: boolean | undefined }) {
  const orders = useOrders(book.id);
  const settings = useSettings();
  const latest = orders.data?.[0];
  const luluReady = Boolean(settings.data?.lulu.clientKeySet);
  const href = `/books/${encodeURIComponent(book.id)}/order`;
  return (
    <section className="card card--pad stack">
      <div className="row row--between">
        <h2 className="h2">Order from Lulu</h2>
        {latest ? <Chip tone={ORDER_STATUS_TONES[latest.status]}>{ORDER_STATUS_LABELS[latest.status]}</Chip> : null}
      </div>
      {latest ? (
        <div className="small">
          {latest.quantity} {latest.quantity === 1 ? 'copy' : 'copies'} to {latest.shippingAddress.city}, {latest.shippingAddress.country_code}
          {latest.cost ? ` · ${formatMoney(latest.cost.totalInclTax, latest.cost.currency)}` : ''}
          {latest.luluJobId ? ` · Lulu job ${latest.luluJobId}` : ''} · {formatDateTime(latest.updatedAt)}
          {orders.data && orders.data.length > 1 ? <span className="muted"> · {orders.data.length} orders</span> : null}
        </div>
      ) : (
        <div className="muted small">
          {disabled
            ? 'Lay out and render the book, then order printed copies.'
            : luluReady
              ? 'Validate the PDFs with Lulu, get a live quote, place the print job and pay on lulu.com.'
              : 'Connect Lulu in Settings to quote and order printed copies; the PDFs can always be uploaded to any printer by hand.'}
        </div>
      )}
      <div className="actions">
        <LinkButton to={href} variant={latest ? 'default' : 'primary'} icon="printer" size="sm">
          {latest ? 'Open orders' : 'Order printed copies'}
        </LinkButton>
        {!luluReady ? (
          <Link to="/settings" className="small">
            Lulu settings
          </Link>
        ) : null}
      </div>
    </section>
  );
}

import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../components/Shell.tsx';
import { Button, Chip, Note, Select, Skeleton } from '../components/ui.tsx';
import { useAllOrders, useBooks, useImportLuluJob, useLuluPrintJobs, useSettings } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatDateTime, formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '../lib/format.ts';

/** Print jobs Lulu holds that no local order tracks (M7): placed elsewhere, or lost with a database. */
function RemoteJobs({ titles }: { titles: Map<string, string> }) {
  const settings = useSettings();
  const configured = Boolean(settings.data?.lulu.clientKeySet);
  const jobs = useLuluPrintJobs(configured);
  const importJob = useImportLuluJob();
  const [picked, setPicked] = useState<Record<string, string>>({});
  if (!configured) return null;
  const untracked = (jobs.data ?? []).filter((j) => !j.orderId);
  return (
    <section className="stack" style={{ gap: 10, marginTop: 24 }}>
      <div className="row row--between">
        <h2 className="h2">On Lulu, not tracked here</h2>
        <span className="muted small">{jobs.data ? `${jobs.data.length} job${jobs.data.length === 1 ? '' : 's'} on the ${settings.data?.lulu.sandbox ? 'sandbox' : 'production'} account` : ''}</span>
      </div>
      {jobs.isPending ? <Skeleton height={48} /> : null}
      {jobs.isError ? (
        <Note tone="amber">Could not list the print jobs on Lulu: {errorMessage(jobs.error)}</Note>
      ) : null}
      {jobs.data && untracked.length === 0 ? <div className="muted small">Every print job on the account is tracked by an order above.</div> : null}
      {importJob.isError ? (
        <Note tone="error" role="alert">
          {errorMessage(importJob.error)}
        </Note>
      ) : null}
      {untracked.length > 0 ? (
        <ul className="shares">
          {untracked.map((j) => {
            const bookId = j.bookId ?? picked[j.id] ?? '';
            return (
              <li key={j.id} className="share">
                <div className="row row--between" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <Chip outline>{j.status}</Chip>
                    <Chip outline>{j.env}</Chip>
                    <span className="mono small muted">job {j.id}</span>
                  </div>
                  <span className="muted small">{j.createdAt ? formatDateTime(j.createdAt) : ''}</span>
                </div>
                <div className="small">
                  {j.lineItems.map((li) => `${li.quantity} × ${li.title}`).join(', ') || 'No line items'}
                  {j.externalId ? <span className="muted"> · {j.externalId}</span> : null}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {j.bookId ? (
                    <span className="small">Book: {j.bookTitle ?? titles.get(j.bookId)}</span>
                  ) : (
                    <Select value={picked[j.id] ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [j.id]: e.target.value }))} aria-label="Book this job belongs to" style={{ maxWidth: 260 }}>
                      <option value="">Which book is this?</option>
                      {[...titles].map(([id, title]) => (
                        <option key={id} value={id}>
                          {title}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Button size="sm" icon="download" onClick={() => importJob.mutate({ jobId: j.id, ...(j.bookId ? {} : { bookId }) })} disabled={!bookId || importJob.isPending} loading={importJob.isPending && importJob.variables?.jobId === j.id}>
                    Track here
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

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
                  {o.lineItems.length > 1 ? <span className="muted"> + {o.lineItems.length - 1} more book{o.lineItems.length > 2 ? 's' : ''}</span> : null}
                  {o.imported ? <Chip outline>imported</Chip> : null}
                  <span className="muted">
                    {' '}
                    · {o.lineItems.reduce((n, li) => n + li.quantity, 0) || o.quantity} {o.quantity === 1 && o.lineItems.length <= 1 ? 'copy' : 'copies'} to {o.shippingAddress.name}, {o.shippingAddress.city} {o.shippingAddress.country_code}
                    {o.cost ? ` · ${formatMoney(o.cost.totalInclTax, o.cost.currency)}` : ''}
                    {o.luluJobId ? ` · Lulu job ${o.luluJobId}` : ''}
                  </span>
                </div>
                {o.error ? <div className="small" style={{ color: 'var(--red)' }}>{o.error}</div> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <RemoteJobs titles={titles} />
      </div>
    </>
  );
}

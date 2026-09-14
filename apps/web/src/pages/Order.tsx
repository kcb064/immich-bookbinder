import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { FORMAT_PRESETS, luluPodPackageId, SHIPPING_LEVEL_LABELS, ShippingAddress, ShippingLevel } from '@bookbinder/shared';
import type { Book, LuluBinding, LuluFinish, LuluPaper, LuluProduct, RenderJob, ShippingOption } from '@bookbinder/shared';
import { PageHeader } from '../components/Shell.tsx';
import { Icon } from '../components/Icon.tsx';
import { Button, Chip, Field, LinkButton, Note, Select, Skeleton, TextInput } from '../components/ui.tsx';
import { OrderCard } from '../components/OrderCard.tsx';
import { useBook, useCancelOrder, useOrders, usePreflight, usePrepareOrder, useRenders, useSaveBook, useSettings } from '../lib/queries.ts';
import { errorMessage, isApiError } from '../lib/api.ts';
import { formatMoney } from '../lib/format.ts';

const BINDINGS: Array<{ value: LuluBinding; label: string; hint: string }> = [
  { value: 'CW', label: 'Hardcover, casewrap', hint: 'Photo printed on the boards. 24 to 800 pages.' },
  { value: 'LW', label: 'Hardcover, linen with dust jacket', hint: 'Cloth boards, the cover on the jacket.' },
  { value: 'PB', label: 'Softcover, perfect bound', hint: 'Glued paperback.' },
  { value: 'CO', label: 'Coil bound', hint: 'Lies flat; the spine is a coil.' },
  { value: 'SS', label: 'Saddle stitch', hint: 'Stapled booklet; short books only.' },
];
const PAPERS: Array<{ value: LuluPaper; label: string }> = [
  { value: '080CW444', label: '80# coated white (photo paper)' },
  { value: '060UW444', label: '60# uncoated white' },
  { value: '060UC444', label: '60# uncoated cream' },
];
const FINISHES: Array<{ value: LuluFinish; label: string }> = [
  { value: 'M', label: 'Matte' },
  { value: 'G', label: 'Gloss' },
];
const QUALITIES: Array<{ value: LuluProduct['quality']; label: string }> = [
  { value: 'PRE', label: 'Premium colour (photo quality)' },
  { value: 'STD', label: 'Standard colour' },
];

const EMPTY_ADDRESS: ShippingAddress = { name: '', street1: '', street2: '', city: '', state_code: '', postcode: '', country_code: 'US', phone_number: '', email: '' };

/** The newest done render of a kind and whether it still reflects the book (same rule as the server). */
function currentRender(book: Pick<Book, 'updatedAt' | 'pages'>, renders: RenderJob[] | undefined, kind: 'print' | 'cover'): { job: RenderJob | undefined; current: boolean } {
  const job = (renders ?? []).find((r) => r.kind === kind && r.status === 'done');
  const fresh = Boolean(job?.finishedAt && job.finishedAt >= book.updatedAt);
  const sized = kind !== 'cover' || !job?.data?.cover || job.data.cover.pageCount === book.pages.length;
  return { job, current: fresh && sized };
}

/** Product choices that build the pod_package_id; saving them changes the book (and stales the renders). */
function ProductPicker({ book }: { book: Book }) {
  const save = useSaveBook(book.id);
  const format = FORMAT_PRESETS[book.formatId];
  const [product, setProduct] = useState<LuluProduct>(book.luluProduct);
  useEffect(() => setProduct(book.luluProduct), [book.luluProduct]);
  const dirty = JSON.stringify(product) !== JSON.stringify(book.luluProduct);
  const podId = format?.luluTrim ? luluPodPackageId(format, product) : '';
  const pages = book.pages.length;
  const bindingWarning =
    product.binding === 'CW' && (pages < 24 || pages > 800)
      ? 'Casewrap hardcovers need 24 to 800 pages.'
      : product.binding === 'SS' && pages > 48
        ? 'Saddle stitch is for short booklets; Lulu will refuse this page count.'
        : undefined;
  return (
    <section className="card card--pad stack">
      <div className="row row--between">
        <h2 className="h2">Product</h2>
        <span className="mono small muted" title="Lulu pod_package_id">
          {podId}
        </span>
      </div>
      <div className="form-grid">
        <Field label="Binding" hint={BINDINGS.find((b) => b.value === product.binding)?.hint}>
          {({ id }) => (
            <Select id={id} value={product.binding} onChange={(e) => setProduct({ ...product, binding: e.target.value as LuluBinding })}>
              {BINDINGS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Paper">
          {({ id }) => (
            <Select id={id} value={product.paper} onChange={(e) => setProduct({ ...product, paper: e.target.value as LuluPaper })}>
              {PAPERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Cover finish">
          {({ id }) => (
            <Select id={id} value={product.finish} onChange={(e) => setProduct({ ...product, finish: e.target.value as LuluFinish })}>
              {FINISHES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Print quality">
          {({ id }) => (
            <Select id={id} value={product.quality} onChange={(e) => setProduct({ ...product, quality: e.target.value as LuluProduct['quality'] })}>
              {QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {bindingWarning ? <Note tone="amber">{bindingWarning}</Note> : null}
      {dirty ? (
        <div className="actions">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...book, luluProduct: product })}>
            Save product
          </Button>
          <Button variant="ghost" onClick={() => setProduct(book.luluProduct)}>
            Reset
          </Button>
          <span className="muted small">The spine width and price depend on this; the print and cover PDFs must be rendered again after saving.</span>
        </div>
      ) : null}
      {save.isError ? (
        <Note tone="error" role="alert">
          Could not save: {errorMessage(save.error)}
        </Note>
      ) : null}
    </section>
  );
}

function ShippingLevelPicker({ value, onChange, options, currency }: { value: ShippingLevel; onChange: (v: ShippingLevel) => void; options: ShippingOption[]; currency: string | undefined }) {
  const priced = new Map(options.map((o) => [o.level, o]));
  const levels = options.length > 0 ? options.map((o) => o.level) : ShippingLevel.options;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {levels.map((level) => {
        const o = priced.get(level);
        return (
          <label key={level} className={`ship${value === level ? ' ship--on' : ''}`}>
            <input type="radio" name="shipping-level" className="visually-hidden" checked={value === level} onChange={() => onChange(level)} />
            <span className="ship__name">{SHIPPING_LEVEL_LABELS[level]}</span>
            <span className="muted small">
              {o?.totalDaysMin !== undefined && o.totalDaysMax !== undefined ? `${o.totalDaysMin}–${o.totalDaysMax} business days` : ''}
              {o?.traceable ? ' · tracked' : ''}
            </span>
            <span className="mono small">{o?.cost ? formatMoney(o.cost, o.currency ?? currency) : options.length > 0 ? '' : 'priced at quote'}</span>
          </label>
        );
      })}
    </div>
  );
}

function AddressField({ label, value, onChange, required, hint, type = 'text', autoComplete }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; hint?: string; type?: string; autoComplete?: string }) {
  return (
    <Field label={required ? label : `${label} (optional)`} hint={hint}>
      {({ id, describedBy }) => <TextInput id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} autoComplete={autoComplete} required={required} />}
    </Field>
  );
}

export function OrderPage() {
  const { id } = useParams();
  const bookId = id ?? '';
  const book = useBook(id);
  const settings = useSettings();
  const renders = useRenders(id);
  const preflight = usePreflight(id, Boolean(book.data && book.data.pages.length > 0));
  const orders = useOrders(id);
  const prepare = usePrepareOrder(bookId);
  const cancel = useCancelOrder(bookId);

  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const [addressTouched, setAddressTouched] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [level, setLevel] = useState<ShippingLevel>('MAIL');
  const [contactEmail, setContactEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const last = settings.data?.lulu.lastAddress;
  useEffect(() => {
    if (last && !addressTouched) setAddress({ ...EMPTY_ADDRESS, ...last });
  }, [last, addressTouched]);

  const latest = orders.data?.[0];
  const pricedOptions = useMemo(() => orders.data?.find((o) => o.shippingOptions.length > 0 && o.shippingAddress.country_code === address.country_code)?.shippingOptions ?? [], [orders.data, address.country_code]);
  const currency = orders.data?.find((o) => o.cost)?.cost?.currency;

  if (book.isPending) {
    return (
      <>
        <PageHeader title={<Skeleton width={200} height={20} />} />
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
        <PageHeader title="Order">
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
  const format = FORMAT_PRESETS[b.formatId];
  const luluFormat = format?.vendor === 'lulu';
  const luluReady = Boolean(settings.data?.lulu.clientKeySet);
  const env = settings.data?.lulu.sandbox === false ? 'production' : 'sandbox';
  const publicUrl = settings.data?.publicUrl;
  const print = currentRender(b, renders.data, 'print');
  const cover = currentRender(b, renders.data, 'cover');
  const preflightErrors = preflight.data?.items.filter((i) => i.level === 'error').length ?? 0;
  const blockers: Array<{ text: string; to?: string; label?: string }> = [];
  if (!luluFormat) blockers.push({ text: `${format?.name ?? b.formatId} is a home-print format; Lulu cannot print it.` });
  if (!luluReady) blockers.push({ text: `No Lulu ${env} credentials are saved.`, to: '/settings', label: 'Open Settings' });
  if (!publicUrl) blockers.push({ text: 'No public URL is configured; Lulu downloads the PDFs from it.', to: '/settings', label: 'Open Settings' });
  if (b.pages.length === 0) blockers.push({ text: 'The book has no pages yet.', to: `/books/${encodeURIComponent(b.id)}`, label: 'Open the book' });
  else if (preflightErrors > 0) blockers.push({ text: `Preflight has ${preflightErrors} error${preflightErrors === 1 ? '' : 's'} to fix first.`, to: `/books/${encodeURIComponent(b.id)}`, label: 'See print readiness' });
  if (b.pages.length > 0 && !print.current) blockers.push({ text: print.job ? 'The print PDF is older than the last change to the book; render it again.' : 'No print PDF has been rendered yet.', to: `/books/${encodeURIComponent(b.id)}`, label: 'Render on the book page' });
  if (luluFormat && b.pages.length > 0 && !cover.current) blockers.push({ text: cover.job ? 'The cover PDF is stale (book changed or page count moved); render it again.' : 'No cover PDF has been rendered yet.', to: `/books/${encodeURIComponent(b.id)}`, label: 'Render on the book page' });
  const canOrder = blockers.length === 0;
  const busy = orders.data?.some((o) => o.status === 'validating' || o.status === 'draft') ?? false;

  const parsed = ShippingAddress.safeParse({ ...address, street2: address.street2 || undefined, state_code: address.state_code || undefined });
  const addressErrors = new Map<string, string>();
  if (!parsed.success) for (const i of parsed.error.issues) addressErrors.set(String(i.path[0]), i.message);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!parsed.success || !canOrder) return;
    prepare.mutate({ quantity, shippingLevel: level, shippingAddress: parsed.data, ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}) });
  };

  const set = (patch: Partial<ShippingAddress>) => {
    setAddressTouched(true);
    setAddress((a) => ({ ...a, ...patch }));
  };
  const err = (field: string) => (submitted ? addressErrors.get(field) : undefined);

  return (
    <>
      <PageHeader
        title={
          <span className="row">
            <Link to={`/books/${encodeURIComponent(b.id)}`} className="muted" aria-label="Back to the book" style={{ display: 'inline-flex' }}>
              <Icon name="arrowLeft" />
            </Link>
            Order {b.title}
            <Chip tone={env === 'production' ? 'amber' : 'neutral'}>{env}</Chip>
          </span>
        }
      >
        <LinkButton to={`/books/${encodeURIComponent(b.id)}`} icon="book">
          Book page
        </LinkButton>
      </PageHeader>

      <div className="content content--narrow">
        <div className="stack" style={{ gap: 24 }}>
          {env === 'production' ? (
            <Note tone="amber">
              Production is on: a placed order becomes a real print job that costs money once you pay it on lulu.com. Switch to the sandbox in Settings to rehearse.
            </Note>
          ) : (
            <Note tone="accent">
              Sandbox: Lulu validates and prices the files but never prints or charges. Sandbox jobs are paid with the test balance on the sandbox site.
            </Note>
          )}

          {blockers.length > 0 ? (
            <section className="card card--pad stack">
              <h2 className="h2">Before ordering</h2>
              <ul className="preflight">
                {blockers.map((bl) => (
                  <li key={bl.text} className="preflight__item preflight__item--error">
                    <Icon name="alert" size={16} />
                    <div className="grow">
                      {bl.text}
                      {bl.to ? (
                        <>
                          {' '}
                          <Link to={bl.to} className="small">
                            {bl.label}
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <Note tone="neutral" icon="check">
              Preflight is clean and the print and cover PDFs are current ({b.pages.length} pages, {format?.name}).
            </Note>
          )}

          {luluFormat ? <ProductPicker book={b} /> : null}

          <form className="card card--pad stack" onSubmit={onSubmit} noValidate>
            <h2 className="h2">Ship to</h2>
            <div className="form-grid">
              <AddressField label="Full name" value={address.name} onChange={(v) => set({ name: v })} required autoComplete="name" />
              <AddressField label="Email" value={address.email} onChange={(v) => set({ email: v })} required type="email" autoComplete="email" hint={err('email') ?? 'The carrier may use it for delivery notices.'} />
              <AddressField label="Street" value={address.street1} onChange={(v) => set({ street1: v })} required autoComplete="address-line1" />
              <AddressField label="Street, line 2" value={address.street2 ?? ''} onChange={(v) => set({ street2: v })} autoComplete="address-line2" />
              <AddressField label="City" value={address.city} onChange={(v) => set({ city: v })} required autoComplete="address-level2" />
              <AddressField label="State / province code" value={address.state_code ?? ''} onChange={(v) => set({ state_code: v.toUpperCase() })} hint="Required for US, CA, AU, MX and a few others (e.g. TX)." autoComplete="address-level1" />
              <AddressField label="Postcode" value={address.postcode} onChange={(v) => set({ postcode: v })} required autoComplete="postal-code" />
              <AddressField label="Country code" value={address.country_code} onChange={(v) => set({ country_code: v.toUpperCase().slice(0, 2) })} required hint={err('country_code') ?? 'Two letters, e.g. US, GB, DE.'} autoComplete="country" />
              <AddressField label="Phone" value={address.phone_number} onChange={(v) => set({ phone_number: v })} required type="tel" hint={err('phone_number') ?? 'Lulu’s carriers require one.'} autoComplete="tel" />
              <AddressField label="Contact email for Lulu" value={contactEmail} onChange={setContactEmail} type="email" hint="Where Lulu writes about the job itself; defaults to the address email." />
            </div>
            {submitted && addressErrors.size > 0 ? (
              <Note tone="error" role="alert">
                Check the address: {[...addressErrors.entries()].map(([k, v]) => `${k.replace('_', ' ')} (${v})`).join(', ')}.
              </Note>
            ) : null}

            <div className="form-grid">
              <Field label="Copies">
                {({ id }) => <TextInput id={id} type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} style={{ maxWidth: 120 }} />}
              </Field>
              <Field label="Shipping" hint={pricedOptions.length > 0 ? 'Prices from the last quote for this country; the total is recalculated when you quote.' : 'Carrier prices appear once Lulu has quoted the order.'}>
                {() => <ShippingLevelPicker value={level} onChange={setLevel} options={pricedOptions} currency={currency} />}
              </Field>
            </div>

            {prepare.isError ? (
              <Note tone="error" role="alert">
                {errorMessage(prepare.error)}
              </Note>
            ) : null}
            <div className="actions">
              <Button type="submit" variant="primary" icon="printer" loading={prepare.isPending} disabled={!canOrder || busy} title={!canOrder ? 'Fix the items above first' : busy ? 'An order is being validated' : undefined}>
                Validate and quote
              </Button>
              <span className="muted small">Publishes the PDFs for Lulu, runs its file checks and prices the order. Nothing is ordered until you place it.</span>
            </div>
          </form>

          <section className="stack" style={{ gap: 12 }}>
            <div className="row row--between">
              <h2 className="h2">Orders</h2>
              {orders.isFetching ? <span className="muted small">Refreshing…</span> : null}
            </div>
            {orders.isPending ? <Skeleton height={80} /> : null}
            {orders.isError ? (
              <Note tone="error" role="alert">
                Could not load orders: {errorMessage(orders.error)}
              </Note>
            ) : null}
            {orders.data && orders.data.length === 0 ? <div className="muted small">No orders yet. The first quote appears here.</div> : null}
            {orders.data?.map((o) => (
              <OrderCard key={o.id} order={o} expanded={o.id === latest?.id} onCancel={cancel.isPending ? undefined : () => cancel.mutate(o.id)} />
            ))}
          </section>
        </div>
      </div>
    </>
  );
}

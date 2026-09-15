import { useState } from 'react';
import type { Book, RenderJob, ShareView } from '@bookbinder/shared';
import { isCurrentRender } from '@bookbinder/layout';
import { Button, Chip, Field, Note, PasswordInput, Select, Skeleton } from './ui.tsx';
import { Icon } from './Icon.tsx';
import { isActiveRender } from './Renders.tsx';
import { useQueryClient } from '@tanstack/react-query';
import { keys, useCreateRender, useCreateShare, useRenders, useRevokeShare, useShares, useUpdateShare } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatDate, formatDateTime, formatNumber } from '../lib/format.ts';

const EXPIRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Never expires' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

/** The newest done preview render, and whether it still reflects the book. */
export function previewState(book: Pick<Book, 'updatedAt'>, renders: RenderJob[] | undefined): { latest: RenderJob | undefined; current: boolean; running: boolean } {
  const previews = (renders ?? []).filter((r) => r.kind === 'preview');
  const latest = previews.find((r) => r.status === 'done');
  const running = previews.some(isActiveRender);
  const current = Boolean(latest && isCurrentRender(latest, book.updatedAt));
  return { latest, current, running };
}

function CopyField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (http on a LAN): the field is selectable.
    }
  };
  return (
    <div className="share__url">
      <input className="input mono small" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
      <Button size="sm" icon={copied ? 'check' : 'link'} onClick={copy} title="Copy link">
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <a className="btn btn--sm btn--icon" href={url} target="_blank" rel="noreferrer" aria-label="Open the viewer" title="Open the viewer">
        <Icon name="external" />
      </a>
    </div>
  );
}

function ShareRow({ bookId, share }: { bookId: string; share: ShareView }) {
  const revoke = useRevokeShare(bookId);
  const update = useUpdateShare(bookId);
  const dead = share.status !== 'active';
  return (
    <li className={`share${dead ? ' share--dead' : ''}`}>
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <Chip tone={share.status === 'active' ? 'green' : share.status === 'expired' ? 'amber' : 'neutral'}>{share.status === 'active' ? 'Active' : share.status === 'expired' ? 'Expired' : 'Revoked'}</Chip>
          {share.hasPassword ? (
            <Chip icon="lock" outline>
              Password
            </Chip>
          ) : null}
          <Chip icon="download" outline>
            {share.allowDownload ? 'PDF download on' : 'View only'}
          </Chip>
        </div>
        {!dead ? (
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ shareId: share.id, allowDownload: !share.allowDownload })} loading={update.isPending} title={share.allowDownload ? 'Turn PDF download off' : 'Let viewers download the PDF'}>
              {share.allowDownload ? 'Disable download' : 'Allow download'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon="x"
              onClick={() => {
                if (window.confirm('Revoke this link? Anyone who has it will see "link revoked".')) revoke.mutate(share.id);
              }}
              loading={revoke.isPending}
            >
              Revoke
            </Button>
          </div>
        ) : null}
      </div>
      {!dead ? <CopyField url={share.url} /> : <div className="mono small muted" style={{ overflowWrap: 'anywhere' }}>{share.url}</div>}
      <div className="muted small">
        Created {formatDateTime(share.createdAt)}
        {share.expiresAt ? ` · ${share.status === 'expired' ? 'expired' : 'expires'} ${formatDate(share.expiresAt)}` : ''}
        {share.revokedAt ? ` · revoked ${formatDateTime(share.revokedAt)}` : ''}
        {` · ${formatNumber(share.views)} ${share.views === 1 ? 'view' : 'views'}`}
        {share.lastViewedAt ? `, last ${formatDateTime(share.lastViewedAt)}` : ''}
      </div>
      {share.warning ? <Note tone="amber">{share.warning}</Note> : null}
      {revoke.isError ? (
        <Note tone="error" role="alert">
          Could not revoke: {errorMessage(revoke.error)}
        </Note>
      ) : null}
      {update.isError ? (
        <Note tone="error" role="alert">
          Could not update: {errorMessage(update.error)}
        </Note>
      ) : null}
    </li>
  );
}

/** "Share" card: create links (expiry, password, download), copy them, keep the web preview current, revoke. */
export function ShareCard({ book, disabled }: { book: Book; disabled?: boolean | undefined }) {
  const shares = useShares(book.id);
  const renders = useRenders(book.id);
  const create = useCreateShare(book.id);
  const qc = useQueryClient();
  const render = useCreateRender(book.id);
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [password, setPassword] = useState('');
  const [download, setDownload] = useState(false);
  const preview = previewState(book, renders.data);
  const busy = renders.data?.some(isActiveRender) ?? false;

  const submit = () => {
    const days = expiry ? Number(expiry) : undefined;
    create.mutate(
      { ...(days ? { expiresInDays: days } : {}), ...(password.trim() ? { password: password.trim() } : {}), allowDownload: download },
      {
        onSuccess: (share) => {
          setOpen(false);
          setPassword('');
          // The server queues the web preview when none reflects the book; show it in the render list.
          if (share.previewQueued) void qc.invalidateQueries({ queryKey: keys.renders(book.id) });
        },
      },
    );
  };

  const list = shares.data ?? [];
  const active = list.filter((s) => s.status === 'active');
  return (
    <section className="card card--pad stack">
      <div className="row row--between">
        <h2 className="h2">Share</h2>
        <Button size="sm" icon="link" variant={open ? 'default' : 'primary'} onClick={() => setOpen((o) => !o)} disabled={disabled} title={disabled ? 'Lay out the book first' : 'Create a viewer link'}>
          {open ? 'Cancel' : 'New link'}
        </Button>
      </div>
      {disabled ? <div className="muted small">Lay out the book to share it. A link shows the pages as spreads in a web viewer; Immich is never exposed.</div> : null}
      {!disabled && active.length > 0 ? (
        preview.running ? (
          <Note tone="accent" role="status">
            Rendering the web preview; links show the new pages when it finishes.
          </Note>
        ) : !preview.current ? (
          <Note tone="amber">
            <div className="row row--between" style={{ gap: 12 }}>
              <span>{preview.latest ? 'The web preview is older than the book. Viewers see the old pages until you re-render it.' : 'No web preview yet: links open on an empty book until it is rendered.'}</span>
              <Button size="sm" icon="image" onClick={() => render.mutate('preview')} disabled={busy} loading={render.isPending}>
                {preview.latest ? 'Re-render' : 'Render preview'}
              </Button>
            </div>
          </Note>
        ) : null
      ) : null}
      {open ? (
        <form
          className="stack share__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Expires" hint="After this the link answers “expired”. You can revoke it any time.">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Password (optional)" hint="Viewers type it once; it is stored hashed and unlocks the link for a day.">
            {({ id, describedBy }) => <PasswordInput id={id} aria-describedby={describedBy} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={4} placeholder="At least 4 characters" />}
          </Field>
          <label className="toggle">
            <input type="checkbox" className="visually-hidden" checked={download} onChange={(e) => setDownload(e.target.checked)} />
            <span className={`toggle__track${download ? ' toggle__track--on' : ''}`} aria-hidden="true">
              <span className="toggle__knob" />
            </span>
            <span>Let viewers download the PDF (the print PDF when it exists, else the proof)</span>
          </label>
          {create.isError ? (
            <Note tone="error" role="alert">
              Could not create the link: {errorMessage(create.error)}
            </Note>
          ) : null}
          <div className="row row--end">
            <Button type="submit" variant="primary" icon="link" loading={create.isPending}>
              Create link
            </Button>
          </div>
        </form>
      ) : null}
      {shares.isPending && !disabled ? <Skeleton height={48} /> : null}
      {shares.isError ? (
        <Note tone="error" role="alert">
          Could not load links: {errorMessage(shares.error)}
        </Note>
      ) : null}
      {list.length > 0 ? (
        <ul className="shares">
          {list.map((s) => (
            <ShareRow key={s.id} bookId={book.id} share={s} />
          ))}
        </ul>
      ) : null}
      {render.isError ? (
        <Note tone="error" role="alert">
          Could not queue the preview: {errorMessage(render.error)}
        </Note>
      ) : null}
    </section>
  );
}

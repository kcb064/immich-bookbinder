import { renderCoverUrl, renderPageUrl, type RenderJob, type RenderKind } from '@bookbinder/shared';
import { Button, Chip, Note } from './ui.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { useCreateRender, useDeleteRender, useRenders } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatDateTime } from '../lib/format.ts';

export const RENDER_KIND_LABELS: Record<RenderKind, string> = { proof: 'Proof PDF', print: 'Print PDF', cover: 'Cover PDF', preview: 'Web preview' };
const RENDER_KIND_ICONS: Record<RenderKind, IconName> = { proof: 'file', print: 'printer', cover: 'book', preview: 'image' };

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function isActiveRender(r: RenderJob): boolean {
  return r.status === 'queued' || r.status === 'running';
}

function StatusChip({ r }: { r: RenderJob }) {
  switch (r.status) {
    case 'queued':
      return <Chip tone="amber">Queued</Chip>;
    case 'running':
      return (
        <Chip tone="amber">
          Rendering {r.pagesDone}/{r.pagesTotal}
        </Chip>
      );
    case 'done':
      return <Chip tone={r.warnings.length ? 'amber' : 'green'}>{r.warnings.length ? `Done, ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}` : 'Done'}</Chip>;
    case 'error':
      return <Chip tone="red">Failed</Chip>;
  }
}

/** Progress bar for a running render. */
export function RenderProgress({ r }: { r: RenderJob }) {
  const pct = r.pagesTotal > 0 ? Math.round((r.pagesDone / r.pagesTotal) * 100) : 0;
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Render progress">
      <div style={{ width: `${r.status === 'queued' ? 4 : Math.max(4, pct)}%` }} />
    </div>
  );
}

interface RenderButtonsProps {
  bookId: string;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
  size?: 'default' | 'sm' | undefined;
  /** Which kinds to offer (default: proof and print). */
  kinds?: readonly RenderKind[] | undefined;
}

const RENDER_HINTS: Record<RenderKind, string> = {
  proof: 'Screen-resolution PDF for checking the layout',
  print: '300 ppi from the originals, ready for the printer',
  cover: 'One-page cover PDF: back, spine and front at 300 ppi',
  preview: 'Page images for the shareable web viewer',
};

/** Buttons that queue a render of each kind; disabled while one is active. */
export function RenderButtons({ bookId, disabled, disabledReason, size, kinds = ['proof', 'print'] }: RenderButtonsProps) {
  const renders = useRenders(bookId);
  const create = useCreateRender(bookId);
  const busy = renders.data?.some(isActiveRender) ?? false;
  const title = disabledReason ?? (busy ? 'A render is already running' : undefined);
  return (
    <>
      {kinds.map((kind) => (
        <Button key={kind} icon={RENDER_KIND_ICONS[kind]} size={size} onClick={() => create.mutate(kind)} disabled={disabled || busy} loading={create.isPending && create.variables === kind} title={title ?? RENDER_HINTS[kind]}>
          {RENDER_KIND_LABELS[kind]}
        </Button>
      ))}
    </>
  );
}

/** Cover and first pages of a done preview render, as small thumbnails. */
function PreviewStrip({ r }: { r: RenderJob }) {
  const pages = Math.min(3, r.pageCount ?? 0);
  return (
    <div className="render__strip" aria-label="Preview pages">
      {r.data?.hasCover ? <img src={renderCoverUrl(r.bookId, r.id)} alt="Cover" loading="lazy" style={{ aspectRatio: '1.9' }} /> : null}
      {Array.from({ length: pages }, (_, i) => (
        <img key={i} src={renderPageUrl(r.bookId, r.id, i)} alt={`Page ${i + 1}`} loading="lazy" />
      ))}
    </div>
  );
}

/** List of a book's renders with download and delete. */
export function RenderList({ bookId }: { bookId: string }) {
  const renders = useRenders(bookId);
  const create = useCreateRender(bookId);
  const remove = useDeleteRender(bookId);

  if (renders.isError) {
    return (
      <Note tone="error" role="alert">
        Could not load PDFs: {errorMessage(renders.error)}
      </Note>
    );
  }
  const list = renders.data ?? [];
  return (
    <div className="stack" style={{ gap: 12 }}>
      {create.isError ? (
        <Note tone="error" role="alert">
          Could not start the render: {errorMessage(create.error)}
        </Note>
      ) : null}
      {remove.isError ? (
        <Note tone="error" role="alert">
          Could not delete: {errorMessage(remove.error)}
        </Note>
      ) : null}
      {list.length === 0 ? <div className="muted small">Nothing rendered yet. A proof is quick and uses Immich previews; the print and cover PDFs pull originals at 300 ppi; the web preview feeds share links.</div> : null}
      <ul className="renders">
        {list.map((r) => (
          <li key={r.id} className="render">
            <div className="render__icon">
              <Icon name={RENDER_KIND_ICONS[r.kind]} />
            </div>
            <div className="render__body">
              <div className="render__title">
                <span>{RENDER_KIND_LABELS[r.kind]}</span>
                <StatusChip r={r} />
              </div>
              <div className="render__meta">
                {formatDateTime(r.createdAt)}
                {r.status === 'done' ? ` · ${r.pageCount ?? r.pagesTotal} page${(r.pageCount ?? r.pagesTotal) === 1 ? '' : 's'} · ${formatBytes(r.fileSizeBytes)}` : ''}
              </div>
              {isActiveRender(r) ? <RenderProgress r={r} /> : null}
              {r.kind === 'preview' && r.status === 'done' ? <PreviewStrip r={r} /> : null}
              {r.status === 'error' && r.error ? <div className="render__error">{r.error}</div> : null}
              {r.status === 'done' && r.warnings.length > 0 ? (
                <ul className="render__warnings">
                  {r.warnings.slice(0, 5).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                  {r.warnings.length > 5 ? <li>…and {r.warnings.length - 5} more</li> : null}
                </ul>
              ) : null}
            </div>
            <div className="render__actions">
              {r.downloadUrl ? (
                <a className="btn btn--sm" href={r.downloadUrl} target="_blank" rel="noreferrer">
                  <Icon name="download" size={16} />
                  Open
                </a>
              ) : null}
              <Button size="sm" variant="ghost" icon="trash" aria-label="Delete PDF" onClick={() => remove.mutate(r.id)} disabled={r.status === 'running' || remove.isPending} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

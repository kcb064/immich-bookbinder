import { Link } from 'react-router';
import type { AiJob, AiJobKind, Book } from '@bookbinder/shared';
import { Icon } from './Icon.tsx';
import { Button, Chip, Note } from './ui.tsx';
import { useAiJobs, useSelection, useSettings, useStartAiJob } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatDateTime, formatNumber } from '../lib/format.ts';

const KIND_LABELS: Record<AiJobKind, string> = { captions: 'Captions & chapter titles', bursts: 'Best of burst', foreword: 'Foreword' };

/** "$0.0123" with enough digits to show cents of a cent. */
export function formatUsd(v: number): string {
  return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}

function describe(job: AiJob): string {
  const r = job.result;
  if (job.status === 'error') return job.error ?? 'failed';
  if (job.status !== 'done' || !r) return job.status === 'running' ? `${job.done}/${job.total}` : job.status;
  switch (job.kind) {
    case 'captions':
      return `${formatNumber(r.captions)} caption${r.captions === 1 ? '' : 's'}, ${formatNumber(r.chapterTitles)} chapter title${r.chapterTitles === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped (typed by you)` : ''}`;
    case 'bursts':
      return `${formatNumber(r.clusters)} burst${r.clusters === 1 ? '' : 's'} judged, ${formatNumber(r.changed)} changed${r.skipped ? `, ${r.skipped} left alone (you decided ${r.skipped === 1 ? 'it' : 'them'} meanwhile)` : ''}`;
    default:
      return r.skipped ? 'kept the foreword you typed' : r.text ? `“${r.text.slice(0, 80)}${r.text.length > 80 ? '…' : ''}”` : 'done';
  }
}

/** Book page → Claude (M7): the three opt-in jobs with their usage and estimated cost. */
export function AiCard({ book, disabled }: { book: Book; disabled: boolean }) {
  const settings = useSettings();
  const ai = settings.data?.ai;
  const jobs = useAiJobs(book.id);
  const start = useStartAiJob(book.id);
  const selection = useSelection(book.id);
  const ready = Boolean(ai?.enabled && ai.apiKeySet);
  const active = jobs.data?.find((j) => j.status === 'queued' || j.status === 'running');
  const bursts = new Map<string, number>();
  for (const c of selection.data?.candidates ?? []) if (c.clusterId) bursts.set(c.clusterId, (bursts.get(c.clusterId) ?? 0) + 1);
  const burstCount = [...bursts.values()].filter((n) => n >= 3).length;
  const total = (jobs.data ?? []).reduce((n, j) => n + (j.usage?.costUsd ?? 0), 0);
  const hasForeword = book.pages.some((p) => p.templateId === 'title-page' && p.slots.some((s) => s.slotId === 'foreword' && s.text));
  const run = (kind: AiJobKind) => {
    if (kind === 'foreword' && hasForeword && !window.confirm('Replace the foreword on the title page with a new one from Claude?')) return;
    start.mutate({ kind, overwrite: kind === 'foreword' && hasForeword });
  };
  const busy = Boolean(active) || start.isPending;

  return (
    <section className="card card--pad stack" aria-labelledby="ai-title">
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <h2 className="h2" id="ai-title">
          <Icon name="sparkles" size={16} /> Claude
        </h2>
        {settings.isSuccess ? (
          ready ? (
            <Chip tone="green" className="mono">
              {ai!.model}
            </Chip>
          ) : (
            <Chip tone="neutral">off</Chip>
          )
        ) : null}
      </div>
      {!ready && settings.isSuccess ? (
        <div className="muted small">
          Optional captions, chapter titles, burst picks and a foreword, written by Claude with your own API key. Only small thumbnails, dates and places
          are sent. <Link to="/settings">Turn it on in Settings.</Link>
        </div>
      ) : (
        <div className="muted small">
          Writes only where you typed nothing; every job lists its tokens and estimated cost. Only thumbnails, dates and places leave this server. Captions go on pages
          whose layout has a caption line (matted photo, hero with strip, contact sheet); chapter titles on every opener.
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <Button size="sm" icon="edit" onClick={() => run('captions')} disabled={!ready || disabled || busy} title={disabled ? 'Lay out the book first' : 'One caption per page with a caption slot, plus chapter titles'}>
          Captions & titles
        </Button>
        <Button size="sm" icon="grid" onClick={() => run('bursts')} disabled={!ready || busy || burstCount === 0} title={burstCount === 0 ? 'No bursts of three or more frames in the selection' : `Judge ${burstCount} burst${burstCount === 1 ? '' : 's'} of three or more frames`}>
          Best of burst{burstCount > 0 ? ` (${burstCount})` : ''}
        </Button>
        <Button size="sm" icon="file" onClick={() => run('foreword')} disabled={!ready || disabled || busy} title={disabled ? 'Lay out the book first' : 'A short paragraph for the title page from the book’s places and dates'}>
          Foreword
        </Button>
      </div>
      {start.isError ? (
        <Note tone="error" role="alert">
          {errorMessage(start.error)}
        </Note>
      ) : null}
      {active ? (
        <Note tone="accent" role="status">
          {KIND_LABELS[active.kind]}: {active.status === 'queued' ? 'queued' : `${active.done} of ${active.total}`}…
        </Note>
      ) : null}
      {jobs.data && jobs.data.length > 0 ? (
        <ul className="ai-jobs">
          {jobs.data.slice(0, 6).map((j) => (
            <li key={j.id} className={`ai-job ai-job--${j.status}`}>
              <div className="ai-job__head">
                <span style={{ fontWeight: 600 }}>{KIND_LABELS[j.kind]}</span>
                <Chip tone={j.status === 'done' ? 'green' : j.status === 'error' ? 'red' : 'amber'}>{j.status}</Chip>
                <span className="muted small" style={{ marginLeft: 'auto' }}>
                  {formatDateTime(j.finishedAt ?? j.createdAt)}
                </span>
              </div>
              <div className="small">{describe(j)}</div>
              {j.usage ? (
                <div className="muted small mono">
                  {formatNumber(j.usage.inputTokens)} in · {formatNumber(j.usage.outputTokens)} out · {j.usage.requests} request{j.usage.requests === 1 ? '' : 's'} · ≈{formatUsd(j.usage.costUsd)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {total > 0 ? <div className="muted small">Estimated spend on this book so far: ≈{formatUsd(total)} (list prices; your invoice is what counts).</div> : null}
    </section>
  );
}

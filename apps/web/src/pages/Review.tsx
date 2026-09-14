import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { WEIGHT_PRESETS, isPicked, presetFor, type BookAsset, type Candidate, type Reason, type ScoringWeights, type SelectionRules, type SelectionRun } from '@bookbinder/shared';
import { PageHeader } from '../components/Shell.tsx';
import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { Button, Chip, Note, Select, Skeleton } from '../components/ui.tsx';
import { isActiveRun, keys, useBook, useBookAssets, useLayoutBook, useSelection, useSetDecisions, useSettings, useStartSelection } from '../lib/queries.ts';
import { errorMessage, isApiError, thumbnailUrl } from '../lib/api.ts';
import { formatNumber, pluralize } from '../lib/format.ts';

type Filter = 'all' | 'picked' | 'alternates' | 'rejected';

const FILTERS: Array<{ id: Filter; name: string }> = [
  { id: 'picked', name: 'Picked' },
  { id: 'alternates', name: 'Alternates' },
  { id: 'rejected', name: 'Rejected' },
  { id: 'all', name: 'All photos' },
];

const WEIGHTS: Array<{ key: keyof ScoringWeights; name: string; hint: string }> = [
  { key: 'sharpness', name: 'Sharpness', hint: 'Crisp focus and good exposure' },
  { key: 'people', name: 'People', hint: 'Faces, named and featured people' },
  { key: 'aesthetic', name: 'Aesthetic', hint: 'Colour, tonal range, composition' },
  { key: 'variety', name: 'Variety', hint: 'Spread across days, hours and places' },
];

const RULES: Array<{ key: 'collapseNearDuplicates' | 'skipBlurry' | 'spreadAcrossDays' | 'includeFavoritesAlways'; name: string }> = [
  { key: 'collapseNearDuplicates', name: 'Collapse near-duplicates' },
  { key: 'skipBlurry', name: 'Skip blurry' },
  { key: 'spreadAcrossDays', name: 'Spread across days' },
  { key: 'includeFavoritesAlways', name: 'Favourites always in' },
];

const PHASE_LABELS: Record<SelectionRun['phase'], string> = {
  queued: 'Waiting to start',
  gather: 'Fetching the photo list from Immich',
  analyze: 'Scoring previews',
  faces: 'Fetching face boxes',
  pick: 'Picking',
  done: 'Done',
};

const REASON_ICONS: Record<Reason['kind'], IconName> = {
  'top-score': 'sparkles',
  favorite: 'sparkles',
  'best-of-burst': 'grid',
  'featured-person': 'people',
  'user-in': 'check',
  'user-out': 'x',
  duplicate: 'grid',
  blurry: 'eyeOff',
  variety: 'trip',
  'below-cut': 'minus',
  'no-analysis': 'alert',
};

const score10 = (v: number): string => (v * 10).toFixed(1);
const dayKey = (takenAt: string | undefined): string => (takenAt ? takenAt.slice(0, 10) : 'undated');

function dayTitle(day: string): string {
  if (day === 'undated') return 'Undated';
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function takenLabel(takenAt: string | undefined): string {
  if (!takenAt) return 'Unknown date';
  const d = new Date(takenAt);
  if (Number.isNaN(d.getTime())) return takenAt;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

function isAlternate(c: Candidate): boolean {
  return !isPicked(c) && c.clusterRank > 0;
}

function matches(c: Candidate, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'picked':
      return isPicked(c);
    case 'alternates':
      return isAlternate(c);
    case 'rejected':
      return !isPicked(c) && c.clusterRank === 0;
  }
}

function sameRules(a: SelectionRules | undefined, b: SelectionRules | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ---------- pieces ---------- */

function Thumb({ c, asset, selected, onSelect }: { c: Candidate; asset: BookAsset | undefined; selected: boolean; onSelect: () => void }) {
  const picked = isPicked(c);
  const names = (asset?.people ?? []).map((p) => p.name).filter(Boolean).slice(0, 2);
  const user = c.decision === 'user-in' || c.decision === 'user-out';
  return (
    <button
      type="button"
      className={`rthumb${selected ? ' rthumb--on' : ''}${picked ? '' : ' rthumb--out'}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${asset?.fileName ?? c.assetId}, score ${score10(c.scores.composite)}, ${picked ? 'in' : 'out'}`}
      title={asset?.fileName}
    >
      <img src={thumbnailUrl(c.assetId)} alt="" loading="lazy" decoding="async" />
      <span className="rthumb__score mono">{score10(c.scores.composite)}</span>
      {c.clusterSize > 1 ? (
        <span className="rthumb__tag rthumb__tag--tr" title={c.clusterRank === 0 ? `Best of ${c.clusterSize} near-duplicates` : 'Near-duplicate of a better shot'}>
          <Icon name="grid" size={11} />×{c.clusterSize}
        </span>
      ) : null}
      {names.length > 0 ? <span className="rthumb__tag rthumb__tag--tl">{names.join(' · ')}</span> : null}
      {asset?.isFavorite ? (
        <span className="rthumb__fav" title="Favourite in Immich">
          <Icon name="sparkles" size={13} />
        </span>
      ) : null}
      {user ? (
        <span className={`rthumb__user${picked ? '' : ' rthumb__user--out'}`} title={picked ? 'You kept this' : 'You removed this'}>
          <Icon name={picked ? 'check' : 'x'} size={11} />
        </span>
      ) : null}
      {c.blurry ? (
        <span className="rthumb__blur" title="Blurry">
          <Icon name="eyeOff" size={12} />
        </span>
      ) : null}
    </button>
  );
}

function ScoreRow({ name, value }: { name: string; value: number }) {
  return (
    <div className="scorerow">
      <span className="muted small">{name}</span>
      <div className="bar" aria-hidden="true">
        <div style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="mono small" style={{ textAlign: 'right' }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function WeightSlider({ name, hint, value, onChange }: { name: string; hint: string; value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <label className="weight" title={hint}>
      <span className="weight__head">
        <span>{name}</span>
        <span className="muted mono small">{pct}</span>
      </span>
      <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => onChange(Number(e.target.value) / 100)} aria-label={`${name} weight`} />
    </label>
  );
}

function Toggle({ name, checked, onChange }: { name: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" className="visually-hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`toggle__track${checked ? ' toggle__track--on' : ''}`} aria-hidden="true">
        <span className="toggle__knob" />
      </span>
      <span>{name}</span>
    </label>
  );
}

function RunProgress({ run }: { run: SelectionRun }) {
  const pct = run.total > 0 ? Math.round((run.done / run.total) * 100) : run.phase === 'queued' || run.phase === 'gather' ? 0 : 100;
  return (
    <Note tone="accent" role="status">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row row--between">
          <span>
            <strong>{PHASE_LABELS[run.phase]}</strong>
            {run.phase === 'analyze' || run.phase === 'faces' ? (
              <span className="muted">
                {' '}
                · {formatNumber(run.done)} of {formatNumber(run.total)}
              </span>
            ) : null}
          </span>
          <span className="mono small muted">{pct}%</span>
        </div>
        <div className="bar" aria-hidden="true">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Note>
  );
}

function Detail({
  c,
  asset,
  cluster,
  assets,
  busy,
  onSelect,
  onDecide,
  onSwap,
}: {
  c: Candidate;
  asset: BookAsset | undefined;
  cluster: Candidate[];
  assets: Map<string, BookAsset>;
  busy: boolean;
  onSelect: (id: string) => void;
  onDecide: (decision: 'user-in' | 'user-out' | 'auto') => void;
  onSwap: (winnerId: string) => void;
}) {
  const picked = isPicked(c);
  const user = c.decision === 'user-in' || c.decision === 'user-out';
  const others = cluster.filter((x) => x.assetId !== c.assetId);
  const winner = cluster.find((x) => x.clusterRank === 0);
  const place = [asset?.city, asset?.country].filter(Boolean).join(', ');
  return (
    <div className="rdetail stack">
      <img className="rdetail__img" src={thumbnailUrl(c.assetId, 'preview')} alt={asset?.fileName ?? ''} />
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset?.fileName ?? c.assetId}</div>
          <div className="muted small">
            {takenLabel(asset?.takenAt)}
            {place ? ` · ${place}` : ''}
          </div>
        </div>
        <span className={`chip mono rdetail__score${picked ? ' chip--green' : ''}`}>{score10(c.scores.composite)}</span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Chip tone={picked ? 'green' : 'neutral'} icon={picked ? 'check' : 'x'}>
          {c.decision === 'user-in' ? 'Kept by you' : c.decision === 'user-out' ? 'Removed by you' : picked ? 'Picked' : isAlternate(c) ? 'Alternate' : 'Rejected'}
        </Chip>
        {asset?.isFavorite ? (
          <Chip tone="amber" icon="sparkles">
            Favourite
          </Chip>
        ) : null}
        {c.blurry ? (
          <Chip tone="red" icon="eyeOff">
            Blurry
          </Chip>
        ) : null}
        {asset?.rating ? <Chip>{'★'.repeat(asset.rating)}</Chip> : null}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <ScoreRow name="Sharpness" value={c.scores.sharpness} />
        <ScoreRow name="Exposure" value={c.scores.exposure} />
        <ScoreRow name="Aesthetic" value={c.scores.aesthetic} />
        <ScoreRow name="People" value={c.scores.people} />
      </div>
      <div className="card rwhy">
        <div className="label" style={{ marginBottom: 6 }}>
          {picked ? 'Why it is in' : 'Why it is out'}
        </div>
        <ul className="rwhy__list">
          {c.reasons.map((r, i) => (
            <li key={`${r.kind}-${i}`}>
              <Icon name={REASON_ICONS[r.kind]} size={14} />
              <span>
                {r.text}
                {r.assetId && r.assetId !== c.assetId ? (
                  <>
                    {' '}
                    <button type="button" className="linkish" onClick={() => onSelect(r.assetId!)}>
                      Show the kept one
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {(asset?.people.length ?? 0) > 0 ? (
        <div className="muted small">
          People: {asset!.people.map((p) => p.name || 'Unnamed').join(', ')}
          {c.faces ? ` · ${pluralize(c.faces.length, 'face')} located` : ''}
        </div>
      ) : null}
      {others.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">{c.clusterRank === 0 ? `Alternates in this burst (${others.length})` : `Same burst (${cluster.length})`}</div>
          <div className="rburst">
            {others.map((o) => (
              <button key={o.assetId} type="button" className={`rburst__item${isPicked(o) ? ' rburst__item--in' : ''}`} onClick={() => onSelect(o.assetId)} title={assets.get(o.assetId)?.fileName}>
                <img src={thumbnailUrl(o.assetId)} alt="" loading="lazy" />
                <span className="mono">{score10(o.scores.composite)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grow" />
      <div className="row" style={{ gap: 8 }}>
        {picked ? (
          <Button icon="x" onClick={() => onDecide('user-out')} loading={busy} className="grow">
            Exclude
          </Button>
        ) : (
          <Button icon="check" variant="primary" onClick={() => onDecide('user-in')} loading={busy} className="grow">
            Include
          </Button>
        )}
        {!picked && winner && winner.assetId !== c.assetId && isPicked(winner) ? (
          <Button icon="swap" onClick={() => onSwap(winner.assetId)} loading={busy} className="grow" title="Keep this one and drop the burst's current pick">
            Use instead
          </Button>
        ) : null}
      </div>
      {user ? (
        <Button variant="ghost" size="sm" icon="undo" onClick={() => onDecide('auto')} loading={busy}>
          Back to the automatic decision
        </Button>
      ) : null}
    </div>
  );
}

/* ---------- page ---------- */

export function ReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const book = useBook(id);
  const assets = useBookAssets(id);
  const selection = useSelection(id);
  const settings = useSettings();
  const start = useStartSelection(id ?? '');
  const decide = useSetDecisions(id ?? '');
  const layout = useLayoutBook(id ?? '');

  const [filter, setFilter] = useState<Filter>('picked');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [rules, setRules] = useState<SelectionRules | undefined>(undefined);
  const savedRules = book.data?.rules;
  const autoStarted = useRef(false);
  const applyTimer = useRef<number | undefined>(undefined);

  const immichReady = Boolean(settings.data?.immich.url && settings.data.immich.apiKeySet);
  const run = selection.data?.run;
  const running = isActiveRun(run);
  const candidates = useMemo(() => selection.data?.candidates ?? [], [selection.data]);
  const summary = selection.data?.summary;
  const assetMap = useMemo(() => new Map((assets.data ?? []).map((a) => [a.id, a])), [assets.data]);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.assetId, c])), [candidates]);

  // Local copy of the rules for the sliders; re-synced when the server's copy changes (unless an edit is pending).
  useEffect(() => {
    if (savedRules && !applyTimer.current) setRules(savedRules);
  }, [savedRules]);

  // A finished run may have gathered photos and changed the book's status: refresh both.
  const runState = run ? `${run.id}:${run.status}` : '';
  useEffect(() => {
    if (!id || !run || run.status !== 'done') return;
    void qc.invalidateQueries({ queryKey: keys.bookAssets(id) });
    void qc.invalidateQueries({ queryKey: keys.book(id) });
    void qc.invalidateQueries({ queryKey: keys.books, exact: true });
  }, [id, runState, qc]);

  // First visit: start scoring automatically once the book is known and nothing has run yet.
  useEffect(() => {
    if (autoStarted.current || !book.data || !selection.isSuccess || !immichReady) return;
    if (selection.data.candidates.length === 0 && !selection.data.run) {
      autoStarted.current = true;
      start.mutate({});
    }
  }, [book.data, selection.isSuccess, selection.data, immichReady, start]);

  // Weight and rule changes re-run the picker after a short pause (analysis is cached, so this is quick).
  const updateRules = (next: SelectionRules) => {
    setRules(next);
    if (applyTimer.current) window.clearTimeout(applyTimer.current);
    applyTimer.current = window.setTimeout(() => {
      applyTimer.current = undefined;
      if (!sameRules(next, savedRules)) start.mutate({ rules: next });
    }, 900);
  };
  useEffect(() => () => window.clearTimeout(applyTimer.current), []);

  const visible = useMemo(() => candidates.filter((c) => matches(c, filter)), [candidates, filter]);
  const groups = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    for (const c of visible) {
      const k = dayKey(assetMap.get(c.assetId)?.takenAt);
      const g = map.get(k);
      if (g) g.push(c);
      else map.set(k, [c]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible, assetMap]);
  const dayStats = useMemo(() => {
    const stats = new Map<string, { total: number; picked: number; places: Map<string, number> }>();
    for (const c of candidates) {
      const a = assetMap.get(c.assetId);
      const k = dayKey(a?.takenAt);
      let s = stats.get(k);
      if (!s) {
        s = { total: 0, picked: 0, places: new Map() };
        stats.set(k, s);
      }
      s.total++;
      if (isPicked(c)) s.picked++;
      if (a?.city) s.places.set(a.city, (s.places.get(a.city) ?? 0) + 1);
    }
    return stats;
  }, [candidates, assetMap]);
  const counts = useMemo(() => {
    const n = { all: candidates.length, picked: 0, alternates: 0, rejected: 0 };
    for (const c of candidates) {
      if (isPicked(c)) n.picked++;
      else if (isAlternate(c)) n.alternates++;
      else n.rejected++;
    }
    return n;
  }, [candidates]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const cluster = useMemo(() => (selected?.clusterId ? candidates.filter((c) => c.clusterId === selected.clusterId).sort((a, b) => a.clusterRank - b.clusterRank) : []), [candidates, selected]);

  if (book.isPending) {
    return (
      <>
        <PageHeader title={<Skeleton width={220} height={20} />} />
        <div className="content" aria-busy="true">
          <Skeleton height={200} />
        </div>
      </>
    );
  }
  if (book.isError) {
    const notFound = isApiError(book.error) && book.error.status === 404;
    return (
      <>
        <PageHeader title={notFound ? 'Book not found' : 'Review picks'} />
        <div className="content content--narrow">
          <Note tone={notFound ? 'amber' : 'error'} role="alert">
            {notFound ? 'This book does not exist or was deleted.' : `Could not load this book: ${errorMessage(book.error)}`}
          </Note>
        </div>
      </>
    );
  }
  const b = book.data;
  const preset = rules ? presetFor(rules.weights) : undefined;
  const hasPicks = (summary?.picked ?? 0) > 0;

  const onLayout = () => {
    if (b.pages.length > 0 && !window.confirm('Lay the book out again from the current picks? Your page edits will be replaced.')) return;
    layout.mutate({}, { onSuccess: () => navigate(`/books/${encodeURIComponent(b.id)}/edit`) });
  };

  return (
    <>
      <PageHeader
        title={
          <span className="row">
            <Link to={`/books/${encodeURIComponent(b.id)}`} className="muted" aria-label="Back to the book" style={{ display: 'inline-flex' }}>
              <Icon name="arrowLeft" size={18} />
            </Link>
            {b.title} · Review picks
            {summary ? (
              <Chip tone="accent">
                {formatNumber(summary.picked)} of {formatNumber(summary.total)} picked
              </Chip>
            ) : null}
          </span>
        }
      >
        <Button icon="refresh" variant="ghost" onClick={() => start.mutate({ refetch: true })} loading={running && start.isPending} disabled={running || !immichReady} title="Fetch the album again from Immich, then score anything new and pick again">
          Refetch
        </Button>
        <Button icon="swap" onClick={() => start.mutate({})} loading={running} disabled={!immichReady} title="Score and pick again with the current weights">
          Re-run selection
        </Button>
        <Button variant="primary" iconRight="chevronRight" onClick={onLayout} loading={layout.isPending} disabled={!hasPicks || running || !immichReady}>
          Lay out pages
        </Button>
      </PageHeader>

      <div className="review">
        <aside className="review__rail">
          <nav className="stack" style={{ gap: 4 }} aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`nav rfilter${filter === f.id ? ' nav--on' : ''}`} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
                <span className="nav__label">{f.name}</span>
                <span className="mono small faint">{formatNumber(counts[f.id])}</span>
              </button>
            ))}
          </nav>
          {rules ? (
            <>
              <div className="stack" style={{ gap: 8 }}>
                <div className="label">Scoring preset</div>
                <Select
                  value={preset?.id ?? 'custom'}
                  onChange={(e) => {
                    const p = WEIGHT_PRESETS.find((x) => x.id === e.target.value);
                    if (p) updateRules({ ...rules, weights: p.weights });
                  }}
                  aria-label="Scoring preset"
                >
                  {WEIGHT_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  {!preset ? <option value="custom">Custom</option> : null}
                </Select>
                {preset ? <div className="muted small">{preset.description}</div> : null}
              </div>
              <div className="stack" style={{ gap: 12 }}>
                {WEIGHTS.map((w) => (
                  <WeightSlider key={w.key} name={w.name} hint={w.hint} value={rules.weights[w.key]} onChange={(v) => updateRules({ ...rules, weights: { ...rules.weights, [w.key]: v } })} />
                ))}
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div className="label">Rules</div>
                {RULES.map((r) => (
                  <Toggle key={r.key} name={r.name} checked={rules[r.key]} onChange={(v) => updateRules({ ...rules, [r.key]: v })} />
                ))}
              </div>
              <div className="muted small" style={{ lineHeight: 1.5 }}>
                Target: about {formatNumber(summary?.targetPhotos)} photos for {rules.targetPages} pages. Changes re-run the picker; your own keeps and removals stay.
              </div>
            </>
          ) : null}
        </aside>

        <section className="review__main">
          {!immichReady && settings.isSuccess ? (
            <Note tone="amber">
              <Link to="/settings">Connect Immich in Settings</Link> before selecting photos.
            </Note>
          ) : null}
          {run && running ? <RunProgress run={run} /> : null}
          {run && run.status === 'error' ? (
            <Note tone="error" role="alert">
              Selection failed: {run.error}
            </Note>
          ) : null}
          {run && run.status === 'done' && run.warnings.length > 0 ? (
            <Note tone="amber">
              <div className="stack" style={{ gap: 4 }}>
                {run.warnings.map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>
            </Note>
          ) : null}
          {start.isError ? (
            <Note tone="error" role="alert">
              Could not start: {errorMessage(start.error)}
            </Note>
          ) : null}
          {decide.isError ? (
            <Note tone="error" role="alert">
              Could not save that decision: {errorMessage(decide.error)}
            </Note>
          ) : null}
          {layout.isError ? (
            <Note tone="error" role="alert">
              Layout failed: {errorMessage(layout.error)}
            </Note>
          ) : null}
          {selection.isError ? (
            <Note tone="error" role="alert">
              Could not load the selection: {errorMessage(selection.error)}
            </Note>
          ) : null}

          {selection.isSuccess && candidates.length === 0 && !running ? (
            <div className="card empty">
              <div className="stack" style={{ gap: 8, alignItems: 'center' }}>
                <div className="empty__title">Nothing scored yet</div>
                <div className="muted" style={{ maxWidth: 480, textAlign: 'center' }}>
                  Selection fetches the album from Immich, scores every preview for sharpness, exposure, people and composition, collapses bursts and picks the best spread of days.
                </div>
                <Button variant="primary" icon="sparkles" onClick={() => start.mutate({})} loading={start.isPending} disabled={!immichReady}>
                  Select photos
                </Button>
              </div>
            </div>
          ) : null}

          {groups.length === 0 && candidates.length > 0 ? <div className="muted" style={{ padding: 24, textAlign: 'center' }}>No photos in this view.</div> : null}

          {groups.map(([day, list]) => {
            const s = dayStats.get(day);
            const place = s ? [...s.places.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
            return (
              <section key={day} className="rday">
                <div className="rday__head">
                  <div className="rday__title">{dayTitle(day)}</div>
                  <div className="muted">
                    {place ? `${place} · ` : ''}
                    {formatNumber(s?.picked)} picked of {formatNumber(s?.total)}
                  </div>
                </div>
                <div className="rgrid">
                  {list.map((c) => (
                    <Thumb key={c.assetId} c={c} asset={assetMap.get(c.assetId)} selected={c.assetId === selectedId} onSelect={() => setSelectedId(c.assetId)} />
                  ))}
                </div>
              </section>
            );
          })}
        </section>

        <aside className="review__side">
          {selected ? (
            <Detail
              c={selected}
              asset={assetMap.get(selected.assetId)}
              cluster={cluster}
              assets={assetMap}
              busy={decide.isPending}
              onSelect={(id) => setSelectedId(id)}
              onDecide={(decision) => decide.mutate([{ assetId: selected.assetId, decision }])}
              onSwap={(winnerId) =>
                decide.mutate([
                  { assetId: selected.assetId, decision: 'user-in' },
                  { assetId: winnerId, decision: 'user-out' },
                ])
              }
            />
          ) : (
            <div className="muted small" style={{ lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Pick a photo</div>
              Every automatic decision is explained here: scores, bursts and the reason a photo is in or out. Include, exclude or swap with one click; nothing is final until the book is printed.
              {summary ? (
                <dl className="kv" style={{ marginTop: 16 }}>
                  <dt>Analysed</dt>
                  <dd>{formatNumber(summary.analyzed)}</dd>
                  <dt>Bursts</dt>
                  <dd>{formatNumber(summary.clusters)}</dd>
                  <dt>Blurry</dt>
                  <dd>{formatNumber(summary.blurry)}</dd>
                  <dt>Days · places</dt>
                  <dd>
                    {formatNumber(summary.days)} · {formatNumber(summary.places)}
                  </dd>
                </dl>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DEFAULT_FORMAT_ID, DEFAULT_THEME_ID, FORMAT_PRESETS, THEMES } from '@bookbinder/shared';
import { PageHeader } from '../components/Shell.tsx';
import { StepRail } from '../components/StepRail.tsx';
import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { Button, CheckboxMark, Chip, Field, Note, Select, Skeleton, TextInput } from '../components/ui.tsx';
import { useAlbums, useCreateBook, useSettings } from '../lib/queries.ts';
import type { AlbumSummary } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatDateRange, formatNumber, formatTrim, pluralize } from '../lib/format.ts';

type SourceKind = 'album' | 'trip' | 'people' | 'smart';

const SOURCES: Array<{ kind: SourceKind; icon: IconName; name: string; desc: string; soon?: string }> = [
  { kind: 'album', icon: 'album', name: 'Album', desc: 'Pick one or more Immich albums.' },
  {
    kind: 'trip',
    icon: 'trip',
    name: 'Trip',
    desc: 'A date range and the places you were. Finds photos that never made it into an album.',
    soon: 'coming in M3',
  },
  {
    kind: 'people',
    icon: 'people',
    name: 'People & pets',
    desc: 'Everything with chosen people, or a pet you have taught the app to find.',
    soon: 'coming in M3',
  },
  {
    kind: 'smart',
    icon: 'sparkles',
    name: 'Smart search',
    desc: 'Describe it: "sunsets over water", "kids at the beach".',
    soon: 'coming in M3',
  },
];

const TARGET_PAGES = 48;

function AlbumRow({ album, checked, onToggle }: { album: AlbumSummary; checked: boolean; onToggle: () => void }) {
  const range = formatDateRange(album.startDate, album.endDate);
  return (
    <li>
      <label className={`album${checked ? ' album--on' : ''}`}>
        <input type="checkbox" className="visually-hidden" checked={checked} onChange={onToggle} />
        <CheckboxMark checked={checked} />
        <span className="album__thumb">
          {album.thumbnailUrl ? (
            <img src={album.thumbnailUrl} alt="" loading="lazy" width={44} height={44} />
          ) : (
            <Icon name="image" />
          )}
        </span>
        <span className="album__text">
          <span className="album__name">{album.name || 'Untitled album'}</span>
          <span className="album__meta">
            {pluralize(album.assetCount, 'photo')}
            {range ? ` · ${range}` : ''}
          </span>
        </span>
      </label>
    </li>
  );
}

function AlbumPicker({
  selected,
  onChange,
}: {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>, albums: AlbumSummary[]) => void;
}) {
  const settings = useSettings();
  const configured = Boolean(settings.data?.immich.url && settings.data.immich.apiKeySet);
  const albums = useAlbums(settings.isSuccess && configured);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const list = albums.data ?? [];
    const q = filter.trim().toLowerCase();
    const filtered = q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list;
    return [...filtered].sort((a, b) => {
      const da = a.endDate ?? a.startDate ?? '';
      const db = b.endDate ?? b.startDate ?? '';
      return db.localeCompare(da) || a.name.localeCompare(b.name);
    });
  }, [albums.data, filter]);

  if (settings.isSuccess && !configured) {
    return (
      <Note tone="amber">
        Immich is not connected yet. <Link to="/settings">Add your server URL and API key in Settings</Link> to list albums.
      </Note>
    );
  }
  if (settings.isError) {
    return (
      <Note tone="error" role="alert">
        Could not load settings: {errorMessage(settings.error)}
      </Note>
    );
  }
  if (albums.isError) {
    return (
      <Note tone="error" role="alert">
        Could not load albums from Immich: {errorMessage(albums.error)}.{' '}
        <Link to="/settings">Check the connection</Link>.
      </Note>
    );
  }

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next, albums.data ?? []);
  };

  return (
    <div className="card albums">
      <div className="albums__toolbar">
        <div className="input-wrap grow">
          <TextInput
            type="search"
            placeholder="Filter albums"
            aria-label="Filter albums"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={albums.isPending}
          />
        </div>
        <span className="muted small" aria-live="polite">
          {albums.data ? `${formatNumber(visible.length)} of ${formatNumber(albums.data.length)}` : ''}
        </span>
      </div>
      {albums.isPending || settings.isPending ? (
        <ul className="albums__list" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="album" aria-hidden="true">
              <Skeleton width={18} height={18} />
              <Skeleton width={44} height={44} />
              <span className="album__text">
                <Skeleton width="45%" />
                <Skeleton width="30%" height={12} />
              </span>
            </li>
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
          {albums.data && albums.data.length > 0 ? 'No albums match that filter.' : 'No albums found in Immich.'}
        </div>
      ) : (
        <ul className="albums__list">
          {visible.map((a) => (
            <AlbumRow key={a.id} album={a} checked={selected.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewBookPage() {
  const navigate = useNavigate();
  const create = useCreateBook();
  const [source, setSource] = useState<SourceKind>('album');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectedAlbums, setSelectedAlbums] = useState<AlbumSummary[]>([]);
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [formatId, setFormatId] = useState(DEFAULT_FORMAT_ID);
  const [submitted, setSubmitted] = useState(false);

  const theme = THEMES[DEFAULT_THEME_ID];
  const format = FORMAT_PRESETS[formatId];
  const photoCount = selectedAlbums.reduce((n, a) => n + a.assetCount, 0);
  const albumIds = selectedAlbums.map((a) => a.id);

  const onSelectionChange = (next: Set<string>, albums: AlbumSummary[]) => {
    setSelected(next);
    // Preserve the order the user picked in.
    const prev = selectedAlbums.filter((a) => next.has(a.id));
    const added = albums.filter((a) => next.has(a.id) && !prev.some((p) => p.id === a.id));
    const ordered = [...prev, ...added];
    setSelectedAlbums(ordered);
    if (!titleEdited) setTitle(ordered[0]?.name ?? '');
  };

  const titleError = submitted && !title.trim() ? 'Give the book a title.' : undefined;
  const selectionError = submitted && albumIds.length === 0 ? 'Pick at least one album.' : undefined;
  const canCreate = title.trim().length > 0 && albumIds.length > 0 && !create.isPending;

  const onCreate = () => {
    setSubmitted(true);
    if (!title.trim() || albumIds.length === 0) return;
    create.mutate(
      {
        title: title.trim(),
        formatId,
        themeId: DEFAULT_THEME_ID,
        rules: { sources: [{ kind: 'album', albumIds }], targetPages: TARGET_PAGES },
      },
      { onSuccess: (book) => navigate(`/books/${encodeURIComponent(book.id)}`) },
    );
  };

  return (
    <>
      <PageHeader title="New book">
        <StepRail current={0} />
      </PageHeader>
      <div className="content">
        <div className="wizard">
          <div className="stack" style={{ gap: 24 }}>
            <section className="stack" style={{ gap: 12 }}>
              <div className="label" id="source-label">
                Where do the photos come from?
              </div>
              <div className="tiles" role="radiogroup" aria-labelledby="source-label">
                {SOURCES.map((s) => {
                  const on = source === s.kind;
                  const disabled = Boolean(s.soon);
                  return (
                    <button
                      key={s.kind}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-disabled={disabled || undefined}
                      className={`card tile${on ? ' tile--on' : ''}${disabled ? ' tile--soon' : ''}`}
                      onClick={() => {
                        if (!disabled) setSource(s.kind);
                      }}
                      tabIndex={on ? 0 : disabled ? -1 : 0}
                    >
                      <span className="tile__head">
                        <Icon name={s.icon} size={20} />
                        {s.soon ? <Chip>{s.soon}</Chip> : on ? <Icon name="check" size={16} /> : null}
                      </span>
                      <span className="tile__name">{s.name}</span>
                      <span className="tile__desc">{s.desc}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {source === 'album' ? (
              <section className="stack" style={{ gap: 12 }}>
                <div className="row row--between">
                  <div className="label">Albums</div>
                  {albumIds.length > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelected(new Set());
                        setSelectedAlbums([]);
                        if (!titleEdited) setTitle('');
                      }}
                    >
                      Clear selection
                    </Button>
                  ) : null}
                </div>
                {selectionError ? (
                  <div className="field__hint field__hint--error" role="alert">
                    {selectionError}
                  </div>
                ) : null}
                <AlbumPicker selected={selected} onChange={onSelectionChange} />
              </section>
            ) : null}
          </div>

          <aside className="wizard__side">
            <div className="card summary">
              <div className="label">Your selection</div>
              <div>
                <div className="summary__big mono">{formatNumber(photoCount)}</div>
                <div className="muted">
                  {photoCount === 1 ? 'photo' : 'photos'} in {pluralize(albumIds.length, 'album')}
                </div>
              </div>
              {selectedAlbums.length > 0 ? (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {selectedAlbums.map((a) => (
                    <Chip key={a.id} tone="accent">
                      {a.name}
                    </Chip>
                  ))}
                </div>
              ) : null}
              <div className="divider" />
              <Field label="Title" error={titleError}>
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    value={title}
                    placeholder="Portugal"
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setTitleEdited(true);
                    }}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    maxLength={120}
                  />
                )}
              </Field>
              <Field label="Size" hint={format ? `${formatTrim(formatId)} · ${format.minPages}–${format.maxPages} pages` : undefined}>
                {({ id, describedBy }) => (
                  <Select id={id} value={formatId} onChange={(e) => setFormatId(e.target.value)} aria-describedby={describedBy}>
                    {Object.values(FORMAT_PRESETS).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="field">
                <div className="field__label">Style</div>
                <div className="row" style={{ height: 44, padding: '0 14px', borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                  <span
                    aria-hidden="true"
                    style={{ width: 18, height: 18, borderRadius: 5, background: theme?.paper ?? '#f6f1e8', border: '1px solid var(--border)' }}
                  />
                  <span className="grow">{theme?.name ?? 'Warm editorial'}</span>
                  <Chip>more soon</Chip>
                </div>
              </div>
              <div className="summary__row">
                <span className="muted">Pages</span>
                <strong className="mono">
                  {TARGET_PAGES} {format ? <span className="muted">({format.minPages}–{format.maxPages})</span> : null}
                </strong>
              </div>
              <div className="divider" />
              <div className="muted small" style={{ lineHeight: 1.5 }}>
                You can change every pick later. Nothing is fetched from Immich until you continue.
              </div>
            </div>
            {create.isError ? (
              <Note tone="error" role="alert">
                Could not create the book: {errorMessage(create.error)}
              </Note>
            ) : null}
            <div className="row row--end">
              <Button variant="ghost" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button variant="primary" iconRight="chevronRight" onClick={onCreate} loading={create.isPending} disabled={!canCreate && submitted}>
                Create book
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

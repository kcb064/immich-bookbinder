import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  DEFAULT_FORMAT_ID,
  DEFAULT_THEME_ID,
  FORMAT_PRESETS,
  THEMES,
  formatIsoRange,
} from '@bookbinder/shared';
import { PageHeader } from '../components/Shell.tsx';
import { StepRail } from '../components/StepRail.tsx';
import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { Button, CheckboxMark, Chip, Field, Note, Select, Skeleton, TextInput } from '../components/ui.tsx';
import {
  useAlbums,
  useCreateBook,
  usePeople,
  usePlaces,
  useSettings,
  useSmartPreview,
  useTrips,
} from '../lib/queries.ts';
import type { AlbumSummary, PersonSummary, SourceInput, TripSuggestion } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatDateRange, formatNumber, formatTrim, pluralize } from '../lib/format.ts';

type SourceKind = 'album' | 'trip' | 'people' | 'smart';

const SOURCES: Array<{ kind: SourceKind; icon: IconName; name: string; desc: string }> = [
  { kind: 'album', icon: 'album', name: 'Album', desc: 'Pick one or more Immich albums.' },
  {
    kind: 'trip',
    icon: 'trip',
    name: 'Trip',
    desc: 'A date range and the places you were. Finds photos that never made it into an album.',
  },
  {
    kind: 'people',
    icon: 'people',
    name: 'People',
    desc: 'Everything with the people you choose. Pets as a saved search come later.',
  },
  {
    kind: 'smart',
    icon: 'sparkles',
    name: 'Smart search',
    desc: 'Describe it: "sunsets over water", "kids at the beach".',
  },
];

const TARGET_PAGES = 48;
const SMART_LIMITS = [100, 200, 500, 1000];

type BBox = [number, number, number, number];
interface PlaceChoice {
  name: string;
  bbox: BBox;
}

interface TripState {
  /** 'recent' = last 24 months, else a calendar year. */
  range: string;
  suggestionId: string | undefined;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  places: PlaceChoice[];
  includeUngeotagged: boolean;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function personThumb(id: string): string {
  return `/api/immich/people/${encodeURIComponent(id)}/thumbnail`;
}

/** A box of roughly 25 km around a gazetteer hit. */
function boxAround(lat: number, lon: number): BBox {
  const dLat = 0.11;
  const dLon = 0.11 / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return [round4(lon - dLon), round4(lat - dLat), round4(lon + dLon), round4(lat + dLat)];
}
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

function rangeBounds(range: string): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  if (range === 'recent') {
    const from = new Date(Date.UTC(today.getUTCFullYear() - 2, today.getUTCMonth(), today.getUTCDate()));
    return { from: iso(from), to: iso(today) };
  }
  return { from: `${range}-01-01`, to: `${range}-12-31` };
}

function tripTitleFor(t: TripSuggestion): string {
  const month = new Date(`${t.start}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${t.title}, ${month}`;
}

/* ---------- Album ---------- */

function AlbumRow({
  album,
  checked,
  onToggle,
}: {
  album: AlbumSummary;
  checked: boolean;
  onToggle: () => void;
}) {
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

function NotConnected() {
  return (
    <Note tone="amber">
      Immich is not connected yet. <Link to="/settings">Add your server URL and API key in Settings</Link>{' '}
      first.
    </Note>
  );
}

function AlbumPicker({
  selected,
  onChange,
  ready,
}: {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>, albums: AlbumSummary[]) => void;
  ready: boolean;
}) {
  const albums = useAlbums(ready);
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
      {albums.isPending ? (
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
          {albums.data && albums.data.length > 0
            ? 'No albums match that filter.'
            : 'No albums found in Immich.'}
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

/* ---------- Trip ---------- */

function TripPicker({
  value,
  onChange,
  onSuggestion,
  ready,
}: {
  value: TripState;
  onChange: (next: TripState) => void;
  onSuggestion: (t: TripSuggestion | undefined) => void;
  ready: boolean;
}) {
  const bounds = rangeBounds(value.range);
  const trips = useTrips(bounds.from, bounds.to, ready);
  const [placeQuery, setPlaceQuery] = useState('');
  const debouncedPlace = useDebounced(placeQuery, 400);
  const places = usePlaces(debouncedPlace, ready);
  const years = useMemo(() => {
    const y = new Date().getUTCFullYear();
    return Array.from({ length: 10 }, (_, i) => String(y - i));
  }, []);

  const pick = (t: TripSuggestion) => {
    onChange({
      ...value,
      suggestionId: t.id,
      from: t.start,
      to: t.end,
      places: t.places.map((p) => ({ name: p.name, bbox: p.bbox })),
    });
    onSuggestion(t);
  };
  const manual = (patch: Partial<TripState>) => {
    onChange({ ...value, ...patch, suggestionId: undefined });
    onSuggestion(undefined);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card trips">
        <div className="albums__toolbar">
          <span className="label" style={{ marginRight: 'auto' }}>
            Trips found in
          </span>
          <Select
            value={value.range}
            onChange={(e) => onChange({ ...value, range: e.target.value })}
            aria-label="Search range"
            style={{ width: 200 }}
          >
            <option value="recent">Last 24 months</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
        {trips.isPending ? (
          <div className="stack" style={{ padding: 12, gap: 8 }} aria-busy="true">
            <Skeleton height={54} />
            <Skeleton height={54} />
          </div>
        ) : trips.isError ? (
          <Note tone="error" role="alert">
            Could not scan the timeline: {errorMessage(trips.error)}
          </Note>
        ) : trips.data.trips.length === 0 ? (
          <div className="muted" style={{ padding: 20, textAlign: 'center', lineHeight: 1.5 }}>
            No trips away from home in this range ({formatNumber(trips.data.geotagged)} geotagged photos
            scanned). Set the dates below instead.
          </div>
        ) : (
          <ul className="albums__list" role="radiogroup" aria-label="Suggested trips">
            {trips.data.trips.map((t) => {
              const on = value.suggestionId === t.id;
              return (
                <li key={t.id}>
                  <label className={`trip${on ? ' trip--on' : ''}`}>
                    <input
                      type="radio"
                      name="trip"
                      className="visually-hidden"
                      checked={on}
                      onChange={() => pick(t)}
                    />
                    <CheckboxMark checked={on} />
                    <span className="trip__text">
                      <span className="trip__title">{t.title}</span>
                      <span className="trip__meta">
                        {formatIsoRange(`${t.start}T12:00:00Z`, `${t.end}T12:00:00Z`)} ·{' '}
                        {pluralize(t.days, 'day')}
                        {t.country ? ` · ${t.country}` : ''}
                      </span>
                      {t.places.length > 1 ? (
                        <span className="trip__places">
                          {t.places.slice(0, 6).map((p) => (
                            <Chip key={p.name}>
                              {p.name} <span className="muted mono">{p.count}</span>
                            </Chip>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="trip__count">
                      <strong className="mono">{formatNumber(t.photoCount)}</strong>
                      geotagged
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card card--pad stack" style={{ gap: 14 }}>
        <div className="label">Dates and places</div>
        <div className="daterange">
          <Field label="From">
            {({ id }) => (
              <TextInput
                id={id}
                type="date"
                value={value.from}
                max={value.to || undefined}
                onChange={(e) => manual({ from: e.target.value })}
              />
            )}
          </Field>
          <Field label="To">
            {({ id }) => (
              <TextInput
                id={id}
                type="date"
                value={value.to}
                min={value.from || undefined}
                onChange={(e) => manual({ to: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="field__label">Places</div>
          <div className="placechips">
            {value.places.length === 0 ? (
              <span className="muted small">Anywhere in the date range.</span>
            ) : null}
            {value.places.map((p) => (
              <span key={p.name} className="placechip">
                <Icon name="trip" size={12} />
                {p.name}
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => manual({ places: value.places.filter((x) => x.name !== p.name) })}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="input-wrap">
            <TextInput
              type="search"
              placeholder="Add a place: type a town or region"
              aria-label="Add a place"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
            />
          </div>
          {places.data && placeQuery.trim().length > 1 ? (
            places.data.length === 0 ? (
              <div className="muted small">No place called “{placeQuery}” in Immich's gazetteer.</div>
            ) : (
              <div className="placehits" role="listbox" aria-label="Matching places">
                {places.data.slice(0, 8).map((h) => (
                  <button
                    key={`${h.name}-${h.latitude}-${h.longitude}`}
                    type="button"
                    className="placehit"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      if (!value.places.some((p) => p.name === h.name))
                        manual({
                          places: [
                            ...value.places,
                            { name: h.name, bbox: boxAround(h.latitude, h.longitude) },
                          ],
                        });
                      setPlaceQuery('');
                    }}
                  >
                    <span>{h.name}</span>
                    <span className="muted small">{h.region ?? ''}</span>
                  </button>
                ))}
              </div>
            )
          ) : null}
        </div>
        <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="visually-hidden"
            checked={value.includeUngeotagged}
            onChange={(e) => onChange({ ...value, includeUngeotagged: e.target.checked })}
          />
          <CheckboxMark checked={value.includeUngeotagged} />
          <span className="small">
            Include photos without GPS data taken in these dates (cameras without GPS)
          </span>
        </label>
      </div>
    </div>
  );
}

/* ---------- People ---------- */

function PersonTile({
  person,
  checked,
  onToggle,
}: {
  person: PersonSummary;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`person${checked ? ' person--on' : ''}`}>
      <input type="checkbox" className="visually-hidden" checked={checked} onChange={onToggle} />
      <CheckboxMark checked={checked} />
      <span className="person__thumb">
        {person.thumbnailUrl ? (
          <img src={personThumb(person.id)} alt="" loading="lazy" />
        ) : (
          <Icon name="people" />
        )}
      </span>
      <span className="person__name">{person.name || 'Unnamed'}</span>
    </label>
  );
}

function PeoplePicker({
  selected,
  onChange,
  ready,
}: {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>, people: PersonSummary[]) => void;
  ready: boolean;
}) {
  const people = usePeople(ready);
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const list = (people.data?.people ?? []).filter((p) => p.name.trim());
    const q = filter.trim().toLowerCase();
    return (q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [people.data, filter]);
  if (people.isError) {
    return (
      <Note tone="error" role="alert">
        Could not load people from Immich: {errorMessage(people.error)}
      </Note>
    );
  }
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next, people.data?.people ?? []);
  };
  return (
    <div className="card albums">
      <div className="albums__toolbar">
        <div className="input-wrap grow">
          <TextInput
            type="search"
            placeholder="Filter people"
            aria-label="Filter people"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={people.isPending}
          />
        </div>
        <span className="muted small">{people.data ? `${formatNumber(visible.length)} named` : ''}</span>
      </div>
      {people.isPending ? (
        <div className="people-grid" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="person" aria-hidden="true">
              <Skeleton width={64} height={64} />
              <Skeleton width="60%" height={12} />
            </span>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
          {people.data && people.data.people.length > 0
            ? 'No named people match.'
            : 'Immich has no named people yet. Name faces in Immich first.'}
        </div>
      ) : (
        <div className="people-grid">
          {visible.map((p) => (
            <PersonTile key={p.id} person={p} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Optional for every source: people who must appear and get a scoring boost. */
function FeaturedPeople({
  selected,
  onChange,
  ready,
  hidden,
}: {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  ready: boolean;
  hidden: ReadonlySet<string>;
}) {
  const people = usePeople(ready);
  const list = (people.data?.people ?? [])
    .filter((p) => p.name.trim() && !hidden.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!people.data || list.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="row row--between">
        <div className="label">Featured people (optional)</div>
        <span className="muted small">Always appear at least once and score higher</span>
      </div>
      <div className="featured">
        {list.slice(0, 40).map((p) => {
          const on = selected.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`featured__person${on ? ' featured__person--on' : ''}`}
              aria-pressed={on}
              onClick={() => {
                const next = new Set(selected);
                if (on) next.delete(p.id);
                else next.add(p.id);
                onChange(next);
              }}
            >
              <img src={personThumb(p.id)} alt="" loading="lazy" />
              {p.name}
              {on ? <Icon name="star" size={13} /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Smart search ---------- */

function SmartPanel({
  query,
  limit,
  onChange,
  ready,
}: {
  query: string;
  limit: number;
  onChange: (patch: { query?: string; limit?: number }) => void;
  ready: boolean;
}) {
  const debounced = useDebounced(query, 500);
  const preview = useSmartPreview(debounced, ready);
  return (
    <div className="card card--pad stack" style={{ gap: 14 }}>
      <Field
        label="Describe the photos"
        hint="Immich's CLIP search understands scenes, objects and moods, not names. Pets work well: “golden retriever”, “black cat on a sofa”."
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            value={query}
            placeholder="sunsets over water"
            onChange={(e) => onChange({ query: e.target.value })}
            aria-describedby={describedBy}
            maxLength={300}
          />
        )}
      </Field>
      <Field
        label="Photos to consider"
        hint="The best matches by similarity; the selection engine then picks from these."
      >
        {({ id, describedBy }) => (
          <Select
            id={id}
            value={String(limit)}
            onChange={(e) => onChange({ limit: Number(e.target.value) })}
            aria-describedby={describedBy}
          >
            {SMART_LIMITS.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {debounced.trim().length > 1 ? (
        preview.isPending ? (
          <div className="smart-preview" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={84} />
            ))}
          </div>
        ) : preview.isError ? (
          <Note tone="error" role="alert">
            Smart search failed: {errorMessage(preview.error)}
          </Note>
        ) : preview.data.items.length === 0 ? (
          <div className="muted small">Nothing matched. Try a broader description.</div>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            <div className="muted small">Best matches right now:</div>
            <div className="smart-preview">
              {preview.data.items.map((it) => (
                <img
                  key={it.id}
                  src={it.thumbnailUrl}
                  alt={it.fileName ?? ''}
                  title={it.fileName ?? ''}
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

/* ---------- Page ---------- */

export function NewBookPage() {
  const navigate = useNavigate();
  const create = useCreateBook();
  const settings = useSettings();
  const ready = Boolean(settings.data?.immich.url && settings.data.immich.apiKeySet);

  const [source, setSource] = useState<SourceKind>('album');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectedAlbums, setSelectedAlbums] = useState<AlbumSummary[]>([]);
  const [trip, setTrip] = useState<TripState>({
    range: 'recent',
    suggestionId: undefined,
    from: '',
    to: '',
    places: [],
    includeUngeotagged: true,
  });
  const [tripSuggestion, setTripSuggestion] = useState<TripSuggestion | undefined>(undefined);
  const [people, setPeople] = useState<Set<string>>(() => new Set());
  const [peopleNames, setPeopleNames] = useState<Map<string, string>>(() => new Map());
  const [smart, setSmart] = useState({ query: '', limit: 200 });
  const [featured, setFeatured] = useState<Set<string>>(() => new Set());
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [formatId, setFormatId] = useState(DEFAULT_FORMAT_ID);
  const [submitted, setSubmitted] = useState(false);

  const theme = THEMES[DEFAULT_THEME_ID];
  const format = FORMAT_PRESETS[formatId];
  const albumIds = selectedAlbums.map((a) => a.id);

  const suggestTitle = (t: string) => {
    if (!titleEdited) setTitle(t);
  };

  const onAlbums = (next: Set<string>, albums: AlbumSummary[]) => {
    setSelected(next);
    const prev = selectedAlbums.filter((a) => next.has(a.id));
    const added = albums.filter((a) => next.has(a.id) && !prev.some((p) => p.id === a.id));
    const ordered = [...prev, ...added];
    setSelectedAlbums(ordered);
    suggestTitle(ordered[0]?.name ?? '');
  };
  const onPeople = (next: Set<string>, list: PersonSummary[]) => {
    setPeople(next);
    const names = new Map(list.map((p) => [p.id, p.name]));
    setPeopleNames(names);
    const chosen = [...next].map((id) => names.get(id)).filter((n): n is string => Boolean(n));
    suggestTitle(
      chosen.length === 0
        ? ''
        : chosen.length === 1
          ? chosen[0]!
          : chosen.length === 2
            ? `${chosen[0]} & ${chosen[1]}`
            : `${chosen.slice(0, -1).join(', ')} & ${chosen[chosen.length - 1]}`,
    );
  };
  const onTripSuggestion = (t: TripSuggestion | undefined) => {
    setTripSuggestion(t);
    if (t) suggestTitle(tripTitleFor(t));
  };
  const onSmart = (patch: { query?: string; limit?: number }) => {
    setSmart((s) => ({ ...s, ...patch }));
    if (patch.query !== undefined) {
      const q = patch.query.trim();
      suggestTitle(q ? q.charAt(0).toUpperCase() + q.slice(1) : '');
    }
  };

  const tripValid =
    /^\d{4}-\d{2}-\d{2}$/.test(trip.from) && /^\d{4}-\d{2}-\d{2}$/.test(trip.to) && trip.from <= trip.to;
  const sourceValid =
    source === 'album'
      ? albumIds.length > 0
      : source === 'trip'
        ? tripValid
        : source === 'people'
          ? people.size > 0
          : smart.query.trim().length > 0;
  const sourceError =
    !submitted || sourceValid
      ? undefined
      : source === 'album'
        ? 'Pick at least one album.'
        : source === 'trip'
          ? 'Pick a trip or enter a valid date range.'
          : source === 'people'
            ? 'Pick at least one person.'
            : 'Describe what to search for.';
  const titleError = submitted && !title.trim() ? 'Give the book a title.' : undefined;
  const canCreate = title.trim().length > 0 && sourceValid && !create.isPending;

  const buildSource = (): SourceInput => {
    switch (source) {
      case 'album':
        return { kind: 'album', albumIds };
      case 'trip':
        return {
          kind: 'trip',
          takenAfter: new Date(`${trip.from}T00:00:00.000Z`).toISOString(),
          takenBefore: new Date(
            new Date(`${trip.to}T00:00:00.000Z`).getTime() + 86_400_000 - 1,
          ).toISOString(),
          places: trip.places,
          includeUngeotagged: trip.includeUngeotagged,
        };
      case 'people':
        return { kind: 'people', personIds: [...people] };
      case 'smart':
        return { kind: 'smart', query: smart.query.trim(), limit: smart.limit };
    }
  };

  const onCreate = () => {
    setSubmitted(true);
    if (!title.trim() || !sourceValid) return;
    // A person book features its people unless the user picked others.
    const featuredPersonIds = featured.size > 0 ? [...featured] : source === 'people' ? [...people] : [];
    create.mutate(
      {
        title: title.trim(),
        formatId,
        themeId: DEFAULT_THEME_ID,
        rules: { sources: [buildSource()], targetPages: TARGET_PAGES, featuredPersonIds },
      },
      { onSuccess: (book) => navigate(`/books/${encodeURIComponent(book.id)}/review`) },
    );
  };

  const summaryCount: { value: string; label: string } =
    source === 'album'
      ? {
          value: formatNumber(selectedAlbums.reduce((n, a) => n + a.assetCount, 0)),
          label: `${selectedAlbums.reduce((n, a) => n + a.assetCount, 0) === 1 ? 'photo' : 'photos'} in ${pluralize(albumIds.length, 'album')}`,
        }
      : source === 'trip'
        ? tripSuggestion
          ? {
              value: formatNumber(tripSuggestion.photoCount),
              label: 'geotagged photos, plus any without GPS',
            }
          : {
              value: tripValid ? '?' : '—',
              label: tripValid ? 'photos are counted when the book is created' : 'pick a trip or dates',
            }
        : source === 'people'
          ? {
              value: people.size > 0 ? '?' : '—',
              label:
                people.size > 0
                  ? `photos with ${pluralize(people.size, 'person', 'people')}, counted when created`
                  : 'pick people',
            }
          : {
              value: smart.query.trim() ? `≤${formatNumber(smart.limit)}` : '—',
              label: smart.query.trim() ? 'best matches considered' : 'describe the photos',
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
                  return (
                    <button
                      key={s.kind}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`card tile${on ? ' tile--on' : ''}`}
                      onClick={() => setSource(s.kind)}
                      tabIndex={on ? 0 : -1}
                    >
                      <span className="tile__head">
                        <Icon name={s.icon} size={20} />
                        {on ? <Icon name="check" size={16} /> : null}
                      </span>
                      <span className="tile__name">{s.name}</span>
                      <span className="tile__desc">{s.desc}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {settings.isSuccess && !ready ? (
              <NotConnected />
            ) : settings.isError ? (
              <Note tone="error" role="alert">
                Could not load settings: {errorMessage(settings.error)}
              </Note>
            ) : (
              <section className="stack" style={{ gap: 12 }}>
                <div className="row row--between">
                  <div className="label">
                    {source === 'album'
                      ? 'Albums'
                      : source === 'trip'
                        ? 'Trip'
                        : source === 'people'
                          ? 'People'
                          : 'Search'}
                  </div>
                  {source === 'album' && albumIds.length > 0 ? (
                    <Button size="sm" variant="ghost" onClick={() => onAlbums(new Set(), [])}>
                      Clear selection
                    </Button>
                  ) : null}
                </div>
                {sourceError ? (
                  <div className="field__hint field__hint--error" role="alert">
                    {sourceError}
                  </div>
                ) : null}
                {source === 'album' ? (
                  <AlbumPicker selected={selected} onChange={onAlbums} ready={ready} />
                ) : null}
                {source === 'trip' ? (
                  <TripPicker value={trip} onChange={setTrip} onSuggestion={onTripSuggestion} ready={ready} />
                ) : null}
                {source === 'people' ? (
                  <PeoplePicker selected={people} onChange={onPeople} ready={ready} />
                ) : null}
                {source === 'smart' ? (
                  <SmartPanel query={smart.query} limit={smart.limit} onChange={onSmart} ready={ready} />
                ) : null}
              </section>
            )}

            {ready ? (
              <FeaturedPeople
                selected={featured}
                onChange={setFeatured}
                ready={ready}
                hidden={source === 'people' ? people : new Set()}
              />
            ) : null}
          </div>

          <aside className="wizard__side">
            <div className="card summary">
              <div className="label">Your selection</div>
              <div>
                <div className="summary__big mono">{summaryCount.value}</div>
                <div className="muted">{summaryCount.label}</div>
              </div>
              {source === 'album' && selectedAlbums.length > 0 ? (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {selectedAlbums.map((a) => (
                    <Chip key={a.id} tone="accent">
                      {a.name}
                    </Chip>
                  ))}
                </div>
              ) : null}
              {source === 'trip' && tripValid ? (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <Chip tone="accent" icon="calendar">
                    {formatIsoRange(`${trip.from}T12:00:00Z`, `${trip.to}T12:00:00Z`)}
                  </Chip>
                  {trip.places.map((p) => (
                    <Chip key={p.name} icon="trip">
                      {p.name}
                    </Chip>
                  ))}
                </div>
              ) : null}
              {source === 'people' && people.size > 0 ? (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {[...people].map((id) => (
                    <Chip key={id} tone="accent" icon="people">
                      {peopleNames.get(id) ?? 'Person'}
                    </Chip>
                  ))}
                </div>
              ) : null}
              {featured.size > 0 ? (
                <div className="muted small">
                  <Icon name="star" size={12} />{' '}
                  {pluralize(featured.size, 'featured person', 'featured people')}
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
              <Field
                label="Size"
                hint={
                  format ? `${formatTrim(formatId)} · ${format.minPages}–${format.maxPages} pages` : undefined
                }
              >
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    value={formatId}
                    onChange={(e) => setFormatId(e.target.value)}
                    aria-describedby={describedBy}
                  >
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
                <div
                  className="row"
                  style={{
                    height: 44,
                    padding: '0 14px',
                    borderRadius: 9,
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      background: theme?.paper ?? '#f6f1e8',
                      border: '1px solid var(--border)',
                    }}
                  />
                  <span className="grow">{theme?.name ?? 'Warm editorial'}</span>
                  <Chip>more soon</Chip>
                </div>
              </div>
              <div className="summary__row">
                <span className="muted">Pages</span>
                <strong className="mono">
                  {TARGET_PAGES}{' '}
                  {format ? (
                    <span className="muted">
                      ({format.minPages}–{format.maxPages})
                    </span>
                  ) : null}
                </strong>
              </div>
              <div className="divider" />
              <div className="muted small" style={{ lineHeight: 1.5 }}>
                Creating the book fetches the photos and scores every one; the review page then shows what is
                in, what is out and why, with chapters by place. You can change every pick.
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
              <Button
                variant="primary"
                iconRight="chevronRight"
                onClick={onCreate}
                loading={create.isPending}
                disabled={!canCreate && submitted}
              >
                Create book
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

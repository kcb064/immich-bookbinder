import { useEffect, useMemo, useState } from 'react';
import { FORMAT_PRESETS, type Book, type BookAsset, type BookCover, type SlotContent } from '@bookbinder/shared';
import { coverGeometry, placedAssetIds } from '@bookbinder/layout';
import { CoverView, bookMetaFor, coverText } from '@bookbinder/pages';
import { Button, Field, LinkButton, Note, TextInput } from './ui.tsx';
import { useRenders, useSaveBook } from '../lib/queries.ts';
import { errorMessage, thumbnailUrl } from '../lib/api.ts';
import { themeFor } from '../lib/format.ts';
import { editorImageSrc } from '../pages/Editor.tsx';

const TEXT_SLOTS = ['title', 'subtitle'] as const;

/** A cover to start from when a book predates covers: the first placed photo, everything else inherited. */
function fallbackCover(book: Book): BookCover {
  const first = placedAssetIds(book.pages)[0];
  return { templateId: 'cover-editorial', slots: first ? [{ slotId: 'p1', assetId: first }] : [] };
}

function withSlotText(slots: SlotContent[], slotId: string, text: string): SlotContent[] {
  const rest = slots.filter((s) => s.slotId !== slotId);
  return text ? [...rest, { slotId, text }] : rest;
}

/**
 * The cover card on the book page: a live preview of the wrap-around cover, the hero photo picked
 * from the book's placed photos, and the title, dates, spine and back-cover text. Free placement of
 * the photo and texts happens in the editor's cover view (M6).
 */
export function CoverCard({ book, assets }: { book: Book; assets: BookAsset[] }) {
  const format = FORMAT_PRESETS[book.formatId];
  const theme = themeFor(book);
  const save = useSaveBook(book.id);
  const renders = useRenders(book.id);
  const [draft, setDraft] = useState<BookCover | undefined>(book.cover);
  const [picking, setPicking] = useState(false);
  useEffect(() => setDraft(book.cover), [book.cover]);

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const placed = useMemo(() => placedAssetIds(book.pages), [book.pages]);
  const meta = useMemo(() => bookMetaFor(book, assets.filter((a) => placed.includes(a.id)), placed.length), [book, assets, placed]);

  if (!format || format.vendor !== 'lulu') {
    return (
      <div className="stack">
        <div className="label">Cover</div>
        <div className="muted small">Home-print formats have no cover: print the interior PDF and bind it yourself. Choose a Lulu format for a hardcover with a printed wrap.</div>
      </div>
    );
  }
  if (book.pages.length === 0) {
    return (
      <div className="stack">
        <div className="label">Cover</div>
        <div className="muted small">The cover is created with the layout: the best photo wraps the book, with the title and dates on the front.</div>
      </div>
    );
  }

  const cover = draft ?? book.cover;
  // Lulu's exact sheet size once a cover was rendered with Lulu connected (M5); the caliper estimate until then.
  const luluGeometry = renders.data?.find((r) => r.kind === 'cover' && r.status === 'done' && r.data?.cover?.geometry.source === 'lulu' && r.data.cover.pageCount === book.pages.length)?.data?.cover?.geometry;
  const geometry = luluGeometry ?? coverGeometry(format, book.luluProduct, book.pages.length);
  const dirty = JSON.stringify(draft ?? null) !== JSON.stringify(book.cover ?? null);
  const heroId = cover?.slots.find((s) => s.slotId === 'p1')?.assetId;

  const update = (next: BookCover) => setDraft(next);
  const setHero = (assetId: string) => {
    const base = cover ?? fallbackCover(book);
    update({ ...base, slots: [...base.slots.filter((s) => s.slotId !== 'p1'), { slotId: 'p1', assetId }] });
    setPicking(false);
  };

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="label">Cover</div>
        <span className="muted small mono" title={luluGeometry ? 'Sheet size from Lulu /cover-dimensions/ for this product and page count' : 'Estimated from the paper caliper and page count; connect Lulu in Settings and render the cover for exact dimensions'}>
          spine {geometry.spineIn.toFixed(2)} in · {luluGeometry ? 'Lulu' : 'est.'}
        </span>
      </div>
      {cover ? (
        <div className="cover-preview">
          <CoverView cover={cover} geometry={geometry} format={format} theme={theme} assets={assetMap} imageSrc={editorImageSrc('preview')} meta={meta} scale={300 / (geometry.widthIn * 96)} guides />
        </div>
      ) : (
        <Note tone="amber">
          This book predates covers.{' '}
          <button type="button" className="link-btn" onClick={() => update(fallbackCover(book))}>
            Create one
          </button>{' '}
          from the first placed photo.
        </Note>
      )}
      {cover ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row row--between">
            <span className="small muted">{heroId ? (assetMap.get(heroId)?.fileName ?? 'Photo') : 'No photo'}</span>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" variant="ghost" icon="image" onClick={() => setPicking((p) => !p)}>
                {picking ? 'Close' : 'Change photo'}
              </Button>
              <LinkButton size="sm" variant="ghost" icon="edit" to={`/books/${encodeURIComponent(book.id)}/edit?view=cover`} title="Move and resize the photo and texts on the cover sheet">
                Design
              </LinkButton>
            </div>
          </div>
          {picking ? (
            <div className="thumb-grid" role="listbox" aria-label="Cover photo">
              {placed.map((id) => {
                const a = assetMap.get(id);
                return (
                  <button key={id} type="button" className={`thumb-pick${id === heroId ? ' thumb-pick--on' : ''}`} onClick={() => setHero(id)} role="option" aria-selected={id === heroId} title={a?.fileName}>
                    <img src={thumbnailUrl(id)} alt={a?.fileName ?? ''} loading="lazy" />
                  </button>
                );
              })}
            </div>
          ) : null}
          {TEXT_SLOTS.map((slotId) => (
            <Field key={slotId} label={slotId === 'title' ? 'Title' : 'Subtitle'}>
              {({ id }) => (
                <TextInput
                  id={id}
                  value={cover.slots.find((s) => s.slotId === slotId)?.text ?? ''}
                  placeholder={coverText({ ...cover, slots: cover.slots.filter((s) => s.slotId !== slotId) }, slotId, meta) || (slotId === 'subtitle' ? 'Dates of the photos' : book.title)}
                  onChange={(e) => update({ ...cover, slots: withSlotText(cover.slots, slotId, e.target.value) })}
                />
              )}
            </Field>
          ))}
          <Field label="Spine" hint={geometry.spineIn < 0.25 ? 'Hidden: the spine is under 0.25 in.' : undefined}>
            {({ id }) => <TextInput id={id} value={cover.spineText ?? ''} placeholder={book.title} onChange={(e) => update({ ...cover, ...(e.target.value ? { spineText: e.target.value } : { spineText: undefined }) })} />}
          </Field>
          <Field label="Back cover">
            {({ id }) => (
              <textarea id={id} className="input" rows={3} value={cover.blurb ?? ''} placeholder="A few lines for the back." onChange={(e) => update({ ...cover, ...(e.target.value ? { blurb: e.target.value } : { blurb: undefined }) })} />
            )}
          </Field>
          {save.isError ? (
            <Note tone="error" role="alert">
              Could not save the cover: {errorMessage(save.error)}
            </Note>
          ) : null}
          <div className="row row--end" style={{ gap: 8 }}>
            {dirty ? (
              <Button size="sm" variant="ghost" onClick={() => setDraft(book.cover)}>
                Discard
              </Button>
            ) : null}
            <Button size="sm" variant="primary" icon="check" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ ...book, cover: stripUndefined(cover) })}>
              Save cover
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** `spineText: undefined` must not reach the server as a key; zod strips it, but keep the document tidy. */
function stripUndefined(cover: BookCover): BookCover {
  return { templateId: cover.templateId, slots: cover.slots, ...(cover.spineText ? { spineText: cover.spineText } : {}), ...(cover.blurb ? { blurb: cover.blurb } : {}) };
}

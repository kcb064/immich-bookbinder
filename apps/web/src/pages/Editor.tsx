import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { FORMAT_PRESETS, PX_PER_IN, type Book, type BookAsset, type BookFormat, type Page, type Theme } from '@bookbinder/shared';
import { NO_FOLIO_TEMPLATE_IDS, effectivePpi, getTemplate, pagePx, photoSlots, templatesForPhotos } from '@bookbinder/layout';
import { PageView, bookMetaFor, formatTakenDate, placeLabel, spreadIndexOfPage, spreadLabel, toSpreads, type ImageSrc, type SlotOverlayContext, type Spread } from '@bookbinder/pages';
import { Icon } from '../components/Icon.tsx';
import { Button, Chip, LinkButton, Note, Skeleton } from '../components/ui.tsx';
import { RenderButtons, isActiveRender } from '../components/Renders.tsx';
import { useBook, useBookAssets, useLayoutBook, useRenders, useSaveBook } from '../lib/queries.ts';
import { errorMessage, isApiError, thumbnailUrl } from '../lib/api.ts';
import { themeFor } from '../lib/format.ts';
import {
  addPhoto,
  captionSlotId,
  historyPush,
  historyRedo,
  historyUndo,
  insertBlankPage,
  isBodyPage,
  isFlexiblePage,
  isOpenerPage,
  movePage,
  pageAssetIds,
  ratiosOf,
  removePage,
  removePhoto,
  setCaption,
  setCrop,
  setSlotText,
  setTemplate,
  slotText,
  swapSlots,
  unplacedAssets,
  userCaption,
  type History,
  type SlotRef,
} from '../lib/editor.ts';

/** Editor image provider: Immich thumbnails through the server proxy, sized for the canvas or filmstrip. */
export function editorImageSrc(size: 'thumbnail' | 'preview'): ImageSrc {
  return ({ asset }) => thumbnailUrl(asset.id, size);
}

const PREVIEW_SRC = editorImageSrc('preview');
const THUMB_SRC = editorImageSrc('thumbnail');
const AUTOSAVE_MS = 1200;

/** Tiny wireframe of a template's photo slots for the picker. */
function TemplateThumb({ templateId, selected, onClick, title }: { templateId: string; selected: boolean; onClick: () => void; title: string }) {
  const t = getTemplate(templateId);
  const slots = photoSlots(t);
  return (
    <button type="button" className={`tpl${selected ? ' tpl--on' : ''}`} onClick={onClick} title={title} aria-pressed={selected} aria-label={t.name}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {slots.map((s) => (
          <rect key={s.id} x={Math.max(0, s.x)} y={Math.max(0, s.y)} width={Math.min(1, s.x + s.w) - Math.max(0, s.x)} height={Math.min(1, s.y + s.h) - Math.max(0, s.y)} rx={0.008} />
        ))}
      </svg>
    </button>
  );
}

function ppiTone(ppi: number): 'red' | 'amber' | undefined {
  if (ppi < 150) return 'red';
  if (ppi < 200) return 'amber';
  return undefined;
}

interface EditorProps {
  book: Book;
  assets: BookAsset[];
  format: BookFormat;
  theme: Theme;
}

function Editor({ book, assets, format, theme }: EditorProps) {
  const [search, setSearch] = useSearchParams();
  const save = useSaveBook(book.id);
  const layout = useLayoutBook(book.id);
  const renders = useRenders(book.id);

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const ratios = useMemo(() => ratiosOf(assets), [assets]);

  const [history, setHistory] = useState<History>(() => ({ present: book.pages, past: [], future: [] }));
  const pages = history.present;
  /** The page list we last sent to (or received from) the server; `pages !== savedRef` means unsaved edits. */
  const savedRef = useRef<Page[]>(book.pages);
  /** Serialized server pages we already account for, so a save echo or refetch is not a "new layout". */
  const knownServerPages = useRef<string>(JSON.stringify(book.pages));
  const dirty = pages !== savedRef.current;

  // Server pages changed by something other than our own save (a re-layout elsewhere): replace the
  // working copy and the undo stack, unless there are unsaved edits to protect.
  useEffect(() => {
    const json = JSON.stringify(book.pages);
    if (json === knownServerPages.current) return;
    knownServerPages.current = json;
    if (!dirty) {
      savedRef.current = book.pages;
      setHistory({ present: book.pages, past: [], future: [] });
    }
  }, [book.pages, dirty]);

  const apply = useCallback((next: Page[]) => setHistory((h) => historyPush(h, next)), []);
  const undo = useCallback(() => setHistory(historyUndo), []);
  const redo = useCallback(() => setHistory(historyRedo), []);

  // Autosave, debounced; the whole document goes up because pages carry all edits. Refs keep the
  // effect keyed on the page list alone, so a server response does not restart the timer.
  const latest = useRef({ book, save });
  latest.current = { book, save };
  useEffect(() => {
    if (!dirty) return;
    const snapshot = pages;
    const t = setTimeout(() => {
      const { book: b, save: s } = latest.current;
      s.mutate(
        { ...b, pages: snapshot, status: b.status === 'draft' ? 'editing' : b.status },
        {
          onSuccess: (saved) => {
            savedRef.current = snapshot;
            knownServerPages.current = JSON.stringify(saved.pages);
          },
        },
      );
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [pages, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const spreads = useMemo(() => toSpreads(pages), [pages]);
  const requestedSpread = Number(search.get('spread') ?? 0);
  const spreadIndex = Math.max(0, Math.min(spreads.length - 1, Number.isFinite(requestedSpread) ? requestedSpread : 0));
  const spread: Spread | undefined = spreads[spreadIndex];
  const gotoSpread = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(spreads.length - 1, i));
      setSearch((prev) => {
        const next = new URLSearchParams(prev);
        if (clamped === 0) next.delete('spread');
        else next.set('spread', String(clamped));
        return next;
      });
    },
    [spreads.length, setSearch],
  );
  const gotoPage = useCallback((pageIndex: number) => gotoSpread(spreadIndexOfPage(pageIndex)), [gotoSpread]);

  const [selected, setSelected] = useState<SlotRef | undefined>();
  const [swapFrom, setSwapFrom] = useState<SlotRef | undefined>();
  const [focusIndex, setFocusIndex] = useState<number | undefined>();
  const focusPageIndex = focusIndex !== undefined && pages[focusIndex] ? focusIndex : (spread?.right?.index ?? spread?.left?.index ?? 0);
  const focusPage = pages[focusPageIndex];

  // Drop selections that no longer exist (after undo, remove, re-layout).
  useEffect(() => {
    if (selected && !pages[selected.pageIndex]?.slots.some((s) => s.slotId === selected.slotId && s.assetId)) setSelected(undefined);
    if (swapFrom && !pages[swapFrom.pageIndex]) setSwapFrom(undefined);
  }, [pages, selected, swapFrom]);

  const placed = useMemo(() => new Set(pages.flatMap(pageAssetIds)), [pages]);
  // Chapter titles and photo counts follow the working copy of the pages, not the saved book.
  const meta = useMemo(() => bookMetaFor({ ...book, pages }, assets.filter((a) => placed.has(a.id)), placed.size), [book, pages, assets, placed]);
  const chapterStarts = useMemo(() => new Map(book.chapters.map((c) => [c.id, c])), [book.chapters]);
  /** Chapter that opens on a spread (its opener photo page is the spread's left page). */
  const chapterOpening = (sp: Spread) => {
    const page = sp.left ?? sp.right;
    return page?.templateId === 'chapter-photo' && page.chapterId ? chapterStarts.get(page.chapterId) : undefined;
  };
  const tray = useMemo(() => unplacedAssets(pages, assets), [pages, assets]);

  // Fit the spread to the canvas.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setCanvasSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const px = pagePx(format, PX_PER_IN);
  const scale = Math.min(1, (canvasSize.w - 112) / (2 * px.w), (canvasSize.h - 72) / px.h);

  const onSlotClick = (pageIndex: number) => (slot: { id: string }, content: { assetId?: string | undefined } | undefined) => {
    const ref: SlotRef = { pageIndex, slotId: slot.id };
    setFocusIndex(pageIndex);
    if (swapFrom) {
      apply(swapSlots(pages, swapFrom, ref));
      setSwapFrom(undefined);
      setSelected(content?.assetId || pages[swapFrom.pageIndex]?.slots.find((s) => s.slotId === swapFrom.slotId)?.assetId ? ref : undefined);
      return;
    }
    if (content?.assetId) setSelected(ref);
    else if (selected) {
      // Clicking an empty slot with a photo selected moves it there.
      apply(swapSlots(pages, selected, ref));
      setSelected(ref);
    } else setSelected(undefined);
  };

  const removeSelected = useCallback(() => {
    if (!selected) return;
    apply(removePhoto(pages, selected, ratios));
    setSelected(undefined);
  }, [selected, pages, ratios, apply]);

  // Keyboard: arrows page through spreads, Delete removes, Esc clears, Ctrl+Z/Y undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'ArrowLeft') gotoSpread(spreadIndex - 1);
      else if (e.key === 'ArrowRight') gotoSpread(spreadIndex + 1);
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      else if (e.key === 'Escape') {
        setSwapFrom(undefined);
        setSelected(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, gotoSpread, spreadIndex, removeSelected]);

  const selectedAsset = selected ? assetMap.get(pages[selected.pageIndex]?.slots.find((s) => s.slotId === selected.slotId)?.assetId ?? '') : undefined;
  const selectedSlotSpec = selected ? getTemplate(pages[selected.pageIndex]!.templateId).slots.find((s) => s.id === selected.slotId) : undefined;
  const selectedPpi = selectedAsset?.width && selectedAsset.height && selectedSlotSpec ? effectivePpi(selectedAsset.width, selectedAsset.height, selectedSlotSpec.w * format.trimWidthIn, selectedSlotSpec.h * format.trimHeightIn) : undefined;

  const focusPhotos = focusPage ? pageAssetIds(focusPage).map((id) => ({ id, ratio: ratios.get(id) ?? 1.5 })) : [];
  const templateChoices = focusPage && isFlexiblePage(focusPage) && focusPhotos.length > 0 ? templatesForPhotos(focusPhotos) : [];
  const hasCaption = focusPage ? Boolean(captionSlotId(focusPage.templateId)) : false;
  const [captionDraft, setCaptionDraft] = useState<string | undefined>();
  useEffect(() => setCaptionDraft(undefined), [focusPageIndex]);
  const focusChapter = focusPage?.chapterId ? meta.chapters?.get(focusPage.chapterId) : undefined;
  const isChapterTitlePage = focusPage?.templateId === 'chapter-title';
  const [chapterDraft, setChapterDraft] = useState<{ title?: string; subtitle?: string }>({});
  useEffect(() => setChapterDraft({}), [focusPageIndex]);
  const commitChapterText = (slotId: 'title' | 'subtitle') => {
    const draft = chapterDraft[slotId];
    if (!focusPage || draft === undefined) return;
    const auto = slotId === 'title' ? (focusChapter?.title ?? '') : (focusChapter?.subtitle ?? '');
    const current = slotText(focusPage, slotId) ?? '';
    // Typing the automatic text back clears the override.
    const next = draft.trim() === auto ? '' : draft;
    if (next !== current) apply(setSlotText(pages, focusPageIndex, slotId, next));
    setChapterDraft((d) => ({ ...d, [slotId]: undefined }));
  };
  const selectedContent = selected ? pages[selected.pageIndex]?.slots.find((s) => s.slotId === selected.slotId) : undefined;

  const slotOverlay = (ctx: SlotOverlayContext) => {
    if (!ctx.asset) return <span className="slot-empty">{swapFrom || selected ? 'Move here' : 'Empty'}</span>;
    if (!ctx.asset.width || !ctx.asset.height) return null;
    const ppi = effectivePpi(ctx.asset.width, ctx.asset.height, ctx.wIn, ctx.hIn);
    const tone = ppiTone(ppi);
    if (!tone) return null;
    return (
      <span className={`ppi ppi--${tone}`} title={`${Math.round(ppi)} pixels per printed inch; below 200 looks soft in print`}>
        <Icon name="alert" size={11} /> {Math.round(ppi)} ppi
      </span>
    );
  };

  const renderPage = (page: Page | undefined, side: 'left' | 'right', number: number | undefined) => {
    if (!page) return <div className="page-gap" style={{ width: px.w * scale, height: px.h * scale }} aria-hidden="true" />;
    const isFocus = focusPageIndex === page.index;
    return (
      <div className={`page-frame${isFocus ? ' page-frame--focus' : ''}`}>
        <PageView
          page={page}
          format={format}
          theme={theme}
          assets={assetMap}
          imageSrc={PREVIEW_SRC}
          meta={meta}
          side={side}
          folio={NO_FOLIO_TEMPLATE_IDS.has(page.templateId) ? undefined : number}
          scale={scale}
          guides
          selectedSlotId={selected?.pageIndex === page.index ? selected.slotId : swapFrom?.pageIndex === page.index ? swapFrom.slotId : undefined}
          onSlotClick={onSlotClick(page.index)}
          onBackgroundClick={() => {
            setFocusIndex(page.index);
            setSelected(undefined);
          }}
          slotOverlay={slotOverlay}
        />
      </div>
    );
  };

  const latestRender = renders.data?.[0];
  const activeRender = renders.data?.find(isActiveRender);
  const saveState = save.isError ? 'error' : save.isPending ? 'saving' : dirty ? 'dirty' : 'saved';

  const relayout = () => {
    if (!window.confirm('Lay the book out again? Every page edit is replaced by a fresh automatic layout of the same photos.')) return;
    layout.mutate(
      { refetch: false },
      {
        onSuccess: (res) => {
          savedRef.current = res.book.pages;
          knownServerPages.current = JSON.stringify(res.book.pages);
          setHistory({ present: res.book.pages, past: [], future: [] });
          setSelected(undefined);
          setSwapFrom(undefined);
          gotoSpread(0);
        },
      },
    );
  };

  const moveFocus = (delta: number) => {
    if (!focusPage || !isFlexiblePage(focusPage)) return;
    const to = focusPageIndex + delta;
    if (to < 1 || to >= pages.length) return;
    apply(movePage(pages, focusPageIndex, to));
    setFocusIndex(to);
    gotoPage(to);
  };

  return (
    <div className="editor">
      <header className="editor__top">
        <div className="row" style={{ gap: 14, minWidth: 0 }}>
          <Link to={`/books/${encodeURIComponent(book.id)}`} className="editor__back">
            <Icon name="chevronLeft" />
            <span>Book</span>
          </Link>
          <span className="editor__sep" />
          <div className="editor__title" title={book.title}>
            {book.title}
          </div>
          <span className="muted small editor__where">
            Spread {spreadIndex + 1} of {spreads.length}
            {spread ? ` · ${spreadLabel(spread)}` : ''}
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className={`savestate savestate--${saveState}`} role="status">
            {saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'error' ? `Save failed: ${errorMessage(save.error)}` : 'Saved'}
          </span>
          <Button variant="ghost" icon="undo" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={history.past.length === 0} />
          <Button variant="ghost" icon="redo" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={redo} disabled={history.future.length === 0} />
          <span className="editor__sep" />
          <Button icon="layout" onClick={relayout} loading={layout.isPending} title="Automatic layout again (replaces your edits)">
            Re-lay out
          </Button>
          {activeRender ? (
            <Chip tone="amber">
              {activeRender.status === 'queued' ? 'Queued' : `Rendering ${activeRender.pagesDone}/${activeRender.pagesTotal}`}
            </Chip>
          ) : latestRender?.status === 'done' && latestRender.downloadUrl ? (
            <a className="btn" href={latestRender.downloadUrl} target="_blank" rel="noreferrer" title={`Open the latest ${latestRender.kind} PDF`}>
              <Icon name="download" size={16} />
              {latestRender.kind === 'print' ? 'Print PDF' : 'Proof PDF'}
            </a>
          ) : latestRender?.status === 'error' ? (
            <Chip tone="red">PDF failed</Chip>
          ) : null}
          <RenderButtons bookId={book.id} disabled={dirty || save.isPending} disabledReason={dirty ? 'Wait for the save to finish' : undefined} />
        </div>
      </header>

      <div className="editor__body">
        <nav className="filmstrip" aria-label="Spreads">
          {spreads.map((sp) => (
            <button
              key={sp.index}
              type="button"
              className={`film${sp.index === spreadIndex ? ' film--on' : ''}`}
              onClick={() => gotoSpread(sp.index)}
              aria-current={sp.index === spreadIndex ? 'true' : undefined}
              aria-label={`Spread ${sp.index + 1}, ${spreadLabel(sp)}${chapterOpening(sp) ? `, opens ${chapterOpening(sp)!.title}` : ''}`}
            >
              {chapterOpening(sp) ? <span className="film__chapter">{chapterOpening(sp)!.title}</span> : null}
              <span className="film__pages">
                {sp.left ? <PageView page={sp.left} format={format} theme={theme} assets={assetMap} imageSrc={THUMB_SRC} meta={meta} side="left" scale={0.07} /> : <span className="film__blank" />}
                {sp.right ? <PageView page={sp.right} format={format} theme={theme} assets={assetMap} imageSrc={THUMB_SRC} meta={meta} side="right" scale={0.07} /> : <span className="film__blank" />}
              </span>
              <span className="film__label mono">{sp.leftNumber !== undefined && sp.rightNumber !== undefined ? `${sp.leftNumber}–${sp.rightNumber}` : (sp.leftNumber ?? sp.rightNumber)}</span>
            </button>
          ))}
        </nav>

        <div className="canvas" ref={canvasRef}>
          <button type="button" className="canvas__nav canvas__nav--prev" onClick={() => gotoSpread(spreadIndex - 1)} disabled={spreadIndex === 0} aria-label="Previous spread">
            <Icon name="chevronLeft" />
          </button>
          {spread ? (
            <div className="spread" style={{ gap: 0 }}>
              {renderPage(spread.left, 'left', spread.leftNumber)}
              {renderPage(spread.right, 'right', spread.rightNumber)}
            </div>
          ) : null}
          <button type="button" className="canvas__nav canvas__nav--next" onClick={() => gotoSpread(spreadIndex + 1)} disabled={spreadIndex >= spreads.length - 1} aria-label="Next spread">
            <Icon name="chevronRight" />
          </button>
          {swapFrom ? (
            <div className="canvas__hint" role="status">
              <Icon name="swap" size={16} /> Click another photo to swap with it, or press Esc.
              <Button size="sm" variant="ghost" onClick={() => setSwapFrom(undefined)}>
                Cancel
              </Button>
            </div>
          ) : null}
          <div className="canvas__folios mono muted">
            {spread?.leftNumber !== undefined ? <span>{spread.leftNumber}</span> : <span />}
            <span className="canvas__folio-line" />
            {spread?.rightNumber !== undefined ? <span>{spread.rightNumber}</span> : <span />}
          </div>
        </div>

        <aside className="panel" aria-label="Page tools">
          {layout.isError ? (
            <Note tone="error" role="alert">
              Re-layout failed: {errorMessage(layout.error)}
            </Note>
          ) : null}

          {focusPage ? (
            <section className="panel__section">
              <div className="row row--between">
                <div className="label">Page {focusPageIndex + 1}</div>
                <span className="muted small">
                  {isOpenerPage(focusPage) ? getTemplate(focusPage.templateId).name : isBodyPage(focusPage) ? `${focusPhotos.length} photo${focusPhotos.length === 1 ? '' : 's'} · ${getTemplate(focusPage.templateId).name}` : 'Title page'}
                </span>
              </div>
              {focusChapter ? (
                <span className="panel__chapter">
                  <Icon name="chapter" size={13} /> {focusChapter.title}
                  <span className="muted"> · {focusChapter.photoCount} photos</span>
                </span>
              ) : null}
              {isChapterTitlePage ? (
                <div className="stack" style={{ gap: 10 }}>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="field__label">Chapter title</span>
                    <input
                      className="input"
                      value={chapterDraft.title ?? slotText(focusPage, 'title') ?? focusChapter?.title ?? ''}
                      placeholder={focusChapter?.title ?? 'Chapter title'}
                      onChange={(e) => setChapterDraft((d) => ({ ...d, title: e.target.value }))}
                      onBlur={() => commitChapterText('title')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </label>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="field__label">Subtitle</span>
                    <input
                      className="input"
                      value={chapterDraft.subtitle ?? slotText(focusPage, 'subtitle') ?? focusChapter?.subtitle ?? ''}
                      placeholder={focusChapter?.subtitle ?? 'Dates or a line about this chapter'}
                      onChange={(e) => setChapterDraft((d) => ({ ...d, subtitle: e.target.value }))}
                      onBlur={() => commitChapterText('subtitle')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </label>
                  <div className="muted small">The place and dates come from the photos; type over them to change this opener only.</div>
                </div>
              ) : null}
              {templateChoices.length > 1 ? (
                <div className="tpl-grid">
                  {templateChoices.map(({ template }) => (
                    <TemplateThumb key={template.id} templateId={template.id} selected={template.id === focusPage.templateId} title={template.name} onClick={() => apply(setTemplate(pages, focusPageIndex, template.id, ratios))} />
                  ))}
                </div>
              ) : isFlexiblePage(focusPage) && focusPhotos.length > 0 ? (
                <div className="muted small">Only one template holds {focusPhotos.length} photos. Add or remove a photo for more choices.</div>
              ) : focusPage.templateId === 'chapter-photo' ? (
                <div className="muted small">The opener photo fills the page and faces the chapter title. Swap it with any photo, or remove it to leave the page empty.</div>
              ) : null}
              {isBodyPage(focusPage) ? (
                <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <Button size="sm" icon="chevronLeft" onClick={() => moveFocus(-1)} disabled={focusPageIndex <= 1 || isOpenerPage(focusPage)} title={isOpenerPage(focusPage) ? 'Opener pages stay with their chapter' : 'Move this page one position earlier'}>
                    Earlier
                  </Button>
                  <Button size="sm" iconRight="chevronRight" onClick={() => moveFocus(1)} disabled={focusPageIndex >= pages.length - 1 || isOpenerPage(focusPage)} title={isOpenerPage(focusPage) ? 'Opener pages stay with their chapter' : 'Move this page one position later'}>
                    Later
                  </Button>
                  <Button size="sm" variant="ghost" icon="plus" onClick={() => apply(insertBlankPage(pages, focusPageIndex))} title="Insert a blank page after this one">
                    Blank after
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon="trash"
                    onClick={() => {
                      apply(removePage(pages, focusPageIndex));
                      setFocusIndex(Math.max(0, focusPageIndex - 1));
                      gotoPage(Math.max(0, focusPageIndex - 1));
                    }}
                    title="Remove this page; its photos go to the unplaced tray"
                  >
                    Remove page
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="panel__section">
            <div className="label">Selected photo</div>
            {selected && selectedAsset ? (
              <>
                <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <img className="panel__thumb" src={thumbnailUrl(selectedAsset.id)} alt="" />
                  <div className="small" style={{ lineHeight: 1.5, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedAsset.fileName ?? selectedAsset.id}</div>
                    <div className="muted">
                      {[formatTakenDate(selectedAsset.takenAt), placeLabel(selectedAsset)].filter(Boolean).join(' · ') || 'No date or place'}
                    </div>
                    <div className="muted">
                      {selectedAsset.width && selectedAsset.height ? `${selectedAsset.width} × ${selectedAsset.height}` : 'Size unknown'}
                      {selectedPpi !== undefined ? (
                        <>
                          {' · '}
                          <span className={ppiTone(selectedPpi) ? `text-${ppiTone(selectedPpi)}` : ''}>{Math.round(selectedPpi)} ppi in print</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {selectedPpi !== undefined && selectedPpi < 200 ? (
                  <Note tone="amber">This photo has {Math.round(selectedPpi)} pixels per printed inch here; it will look soft. Move it to a smaller slot or pick another shot.</Note>
                ) : null}
                {selectedContent?.crop ? (
                  <div className="row row--between small">
                    <span className="muted">
                      Framed on the faces ({Math.round(selectedContent.crop.focalX * 100)}%, {Math.round(selectedContent.crop.focalY * 100)}%)
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => selected && apply(setCrop(pages, selected, undefined))} title="Back to the centred crop">
                      Centre
                    </Button>
                  </div>
                ) : null}
                <div className="row" style={{ gap: 8 }}>
                  <Button className="grow" icon="swap" onClick={() => setSwapFrom(selected)} aria-pressed={Boolean(swapFrom)} title="Then click another photo to exchange places">
                    Swap
                  </Button>
                  <Button className="grow" variant="danger" icon="x" onClick={removeSelected} title="Remove from the page (Delete)">
                    Remove
                  </Button>
                </div>
              </>
            ) : (
              <div className="muted small">Click a photo on the spread to swap, remove or check its print resolution. Click an empty slot to move a selected photo there.</div>
            )}
          </section>

          {focusPage && hasCaption ? (
            <section className="panel__section">
              <label className="label" htmlFor="caption-input">
                Caption
              </label>
              <textarea
                id="caption-input"
                className="input caption-input"
                rows={2}
                placeholder="Place · date (automatic)"
                value={captionDraft ?? userCaption(focusPage) ?? ''}
                onChange={(e) => setCaptionDraft(e.target.value)}
                onBlur={() => {
                  if (captionDraft !== undefined && captionDraft !== (userCaption(focusPage) ?? '')) apply(setCaption(pages, focusPageIndex, captionDraft));
                  setCaptionDraft(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    (e.target as HTMLTextAreaElement).blur();
                  }
                }}
              />
              <div className="muted small">Leave empty for the automatic place and date, or the Immich description when there is one.</div>
            </section>
          ) : null}

          <section className="panel__section">
            <div className="row row--between">
              <div className="label">Unplaced photos</div>
              <span className="muted small">{tray.length}</span>
            </div>
            {tray.length === 0 ? (
              <div className="muted small">Every gathered photo is on a page. Removed photos land here so you can put them back.</div>
            ) : (
              <div className="tray">
                {tray.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="tray__item"
                    title={`${a.fileName ?? a.id}: add to page ${focusPageIndex + 1}`}
                    onClick={() => {
                      const r = addPhoto(pages, focusPageIndex, a.id, ratios);
                      apply(r.pages);
                      setFocusIndex(r.pageIndex);
                      gotoPage(r.pageIndex);
                    }}
                  >
                    <img src={thumbnailUrl(a.id)} alt={a.fileName ?? ''} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel__section muted small" style={{ lineHeight: 1.5 }}>
            Arrow keys page through spreads. Delete removes the selected photo. Ctrl+Z undoes. Changes save automatically.
          </section>
        </aside>
      </div>
    </div>
  );
}

export function EditorPage() {
  const { id } = useParams();
  const book = useBook(id);
  const assets = useBookAssets(id);

  if (book.isPending || assets.isPending) {
    return (
      <div className="editor editor--loading" aria-busy="true">
        <Skeleton width={320} height={24} />
        <Skeleton height={400} />
      </div>
    );
  }
  if (book.isError || assets.isError) {
    const err = book.error ?? assets.error;
    const notFound = isApiError(err) && err.status === 404;
    return (
      <div className="login">
        <div className="card login__card">
          <h1 className="login__title">{notFound ? 'Book not found' : 'Could not open the editor'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {notFound ? 'This book does not exist or was deleted.' : errorMessage(err)}
          </p>
          <LinkButton to="/" icon="arrowLeft">
            Back to books
          </LinkButton>
        </div>
      </div>
    );
  }
  const b = book.data;
  const format = FORMAT_PRESETS[b.formatId];
  if (!format) {
    return (
      <div className="login">
        <Note tone="error">Unknown format "{b.formatId}".</Note>
      </div>
    );
  }
  if (b.pages.length === 0) {
    return (
      <div className="login">
        <div className="card login__card">
          <h1 className="login__title">Nothing to edit yet</h1>
          <p className="muted" style={{ margin: 0 }}>
            Lay the book out first; the editor works on the generated pages.
          </p>
          <LinkButton to={`/books/${encodeURIComponent(b.id)}`} variant="primary" icon="layout">
            Go to the book
          </LinkButton>
        </div>
      </div>
    );
  }
  return <Editor key={b.id} book={b} assets={assets.data} format={format} theme={themeFor(b.themeId)} />;
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { FORMAT_PRESETS, PX_PER_IN, type Book, type BookAsset, type BookCover, type BookFormat, type Page, type SlotContent, type SlotSpec, type Theme } from '@bookbinder/shared';
import {
  NO_FOLIO_TEMPLATE_IDS,
  NUDGE_IN,
  NUDGE_SHIFT_IN,
  coverGeometry,
  coverSnapLines,
  effectiveSlots,
  effectivePpi,
  getTemplate,
  pagePx,
  pageSlots,
  pageSnapLines,
  photoSlots,
  slotToPx,
  templatesForPhotos,
  type SnapLine,
} from '@bookbinder/layout';
import { CoverView, PageView, bookMetaFor, coverPxToUnits, coverSlotPx, coverText, formatTakenDate, placeLabel, spreadIndexOfPage, spreadLabel, toSpreads, type ImageSrc, type SlotOverlayContext, type Spread } from '@bookbinder/pages';
import { Icon } from '../components/Icon.tsx';
import { Button, Chip, LinkButton, Note, Skeleton } from '../components/ui.tsx';
import { RenderButtons, isActiveRender } from '../components/Renders.tsx';
import { DesignOverlay, DesignPanel, ShortcutHelp, useDesignDrag, type DesignSurface, type FramePatch, type SurfaceBox } from '../components/Designer.tsx';
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
import { addTextBox, coverFrame, currentFrame, deleteSlot, duplicateSlot, nudgeSlot, omitKeys, resetPage, setBoxText, setFrame, setTextStyle, setZ, slotsAddText, slotsDelete, slotsDuplicate, slotsNudge, slotsSetFrame, slotsSetText, slotsSetTextStyle, slotsSetZ, slotsUnsetText, withCoverSlots } from '../lib/designer.ts';

/** Editor image provider: Immich thumbnails through the server proxy, sized for the canvas or filmstrip. */
export function editorImageSrc(size: 'thumbnail' | 'preview'): ImageSrc {
  return ({ asset }) => thumbnailUrl(asset.id, size);
}

const PREVIEW_SRC = editorImageSrc('preview');
const THUMB_SRC = editorImageSrc('thumbnail');
const AUTOSAVE_MS = 1200;
/** `pageIndex` of a slot reference that points at the cover instead of a page. */
const COVER = -1;

/** The editable document: pages and cover share one undo stack. */
interface Doc {
  pages: Page[];
  cover: BookCover | undefined;
}

function docOf(book: Pick<Book, 'pages' | 'cover'>): Doc {
  return { pages: book.pages, cover: book.cover };
}
function docKey(doc: Doc): string {
  return JSON.stringify([doc.pages, doc.cover ?? null]);
}

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

function isTextRole(role: SlotSpec['role']): boolean {
  return role === 'title' || role === 'text' || role === 'caption';
}

/** Page geometry as the drag hook sees it: slot boxes in page px, guides and bounds from the format. */
function pageSurface(page: Page, format: BookFormat, side: 'left' | 'right'): DesignSurface {
  const size = pagePx(format, PX_PER_IN);
  const bleed = format.bleedIn * PX_PER_IN;
  const boxes: SurfaceBox[] = pageSlots(page)
    .filter((s) => s.spec.role !== 'map' && s.spec.role !== 'qr')
    .map((s) => ({
      id: s.spec.id,
      rect: slotToPx(s.spec, format, PX_PER_IN),
      rotation: s.frame.rotation ?? 0,
      kind: s.spec.role === 'hero' || s.spec.role === 'photo' ? 'photo' : s.spec.role === 'folio' ? 'rule' : 'text',
      ratio: s.spec.role === 'hero' || s.spec.role === 'photo' ? s.frame.w * format.trimWidthIn / (s.frame.h * format.trimHeightIn) : undefined,
    }));
  const guides: SnapLine[] = pageSnapLines(format, side).map((l) => ({ ...l, at: l.at * PX_PER_IN + bleed }));
  return {
    width: size.w,
    height: size.h,
    boxes,
    guides,
    bounds: { x: 0, y: 0, w: size.w, h: size.h },
    toFrame: (r) => ({ x: (r.x - bleed) / (format.trimWidthIn * PX_PER_IN), y: (r.y - bleed) / (format.trimHeightIn * PX_PER_IN), w: r.w / (format.trimWidthIn * PX_PER_IN), h: r.h / (format.trimHeightIn * PX_PER_IN) }),
  };
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

  const [history, setHistory] = useState<History<Doc>>(() => ({ present: docOf(book), past: [], future: [] }));
  const doc = history.present;
  const pages = doc.pages;
  /** The document we last sent to (or received from) the server; `doc !== savedRef` means unsaved edits. */
  const savedRef = useRef<Doc>(docOf(book));
  /** Serialized server document we already account for, so a save echo or refetch is not a "new layout". */
  const knownServerDoc = useRef<string>(docKey(docOf(book)));
  const dirty = doc !== savedRef.current;

  // Server document changed by something other than our own save (a re-layout elsewhere, the cover
  // card): replace the working copy and the undo stack, unless there are unsaved edits to protect.
  useEffect(() => {
    const next = docOf(book);
    const json = docKey(next);
    if (json === knownServerDoc.current) return;
    knownServerDoc.current = json;
    if (!dirty) {
      savedRef.current = next;
      setHistory({ present: next, past: [], future: [] });
    }
  }, [book, dirty]);

  const apply = useCallback((nextPages: Page[], coalesce?: string) => setHistory((h) => historyPush(h, { ...h.present, pages: nextPages }, coalesce ? { key: coalesce } : undefined)), []);
  const applyCover = useCallback((next: BookCover, coalesce?: string) => setHistory((h) => historyPush(h, { ...h.present, cover: next }, coalesce ? { key: coalesce } : undefined)), []);
  const undo = useCallback(() => setHistory(historyUndo), []);
  const redo = useCallback(() => setHistory(historyRedo), []);

  // Autosave, debounced; the whole document goes up because pages carry all edits. Refs keep the
  // effect keyed on the document alone, so a server response does not restart the timer.
  const latest = useRef({ book, save });
  latest.current = { book, save };
  useEffect(() => {
    if (!dirty) return;
    const snapshot = doc;
    const t = setTimeout(() => {
      const { book: b, save: s } = latest.current;
      const next: Book = { ...b, pages: snapshot.pages, status: b.status === 'draft' ? 'editing' : b.status };
      if (snapshot.cover) next.cover = snapshot.cover;
      else delete next.cover;
      s.mutate(
        next,
        {
          onSuccess: (saved) => {
            savedRef.current = snapshot;
            knownServerDoc.current = docKey(docOf(saved));
          },
        },
      );
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [doc, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const spreads = useMemo(() => toSpreads(pages), [pages]);
  const hasCover = format.vendor === 'lulu' && Boolean(doc.cover);
  const view: 'spread' | 'cover' = hasCover && search.get('view') === 'cover' ? 'cover' : 'spread';
  // ?page=N (from preflight links) wins over ?spread=N.
  const requestedPage = search.get('page');
  const requestedSpread = requestedPage !== null && Number.isFinite(Number(requestedPage)) ? spreadIndexOfPage(Math.max(0, Number(requestedPage))) : Number(search.get('spread') ?? 0);
  const spreadIndex = Math.max(0, Math.min(spreads.length - 1, Number.isFinite(requestedSpread) ? requestedSpread : 0));
  const spread: Spread | undefined = spreads[spreadIndex];
  const gotoSpread = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(spreads.length - 1, i));
      setSearch((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('page');
        next.delete('view');
        if (clamped === 0) next.delete('spread');
        else next.set('spread', String(clamped));
        return next;
      });
    },
    [spreads.length, setSearch],
  );
  const gotoPage = useCallback((pageIndex: number) => gotoSpread(spreadIndexOfPage(pageIndex)), [gotoSpread]);
  const gotoCover = useCallback(() => {
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('page');
      next.delete('spread');
      next.set('view', 'cover');
      return next;
    });
  }, [setSearch]);

  const [selected, setSelected] = useState<SlotRef | undefined>();
  const [swapFrom, setSwapFrom] = useState<SlotRef | undefined>();
  const [focusIndex, setFocusIndex] = useState<number | undefined>();
  const [help, setHelp] = useState(false);
  const focusPageIndex = focusIndex !== undefined && pages[focusIndex] ? focusIndex : (spread?.right?.index ?? spread?.left?.index ?? 0);
  const focusPage = pages[focusPageIndex];

  /** The selected slot as drawn, on a page or the cover. */
  const selectedSlot = useMemo(() => {
    if (!selected) return undefined;
    if (selected.pageIndex === COVER) return doc.cover ? effectiveSlots(doc.cover.templateId, doc.cover.slots).find((s) => s.spec.id === selected.slotId) : undefined;
    const page = pages[selected.pageIndex];
    return page ? pageSlots(page).find((s) => s.spec.id === selected.slotId) : undefined;
  }, [selected, pages, doc.cover]);

  // Drop selections that no longer exist (after undo, remove, re-layout) or belong to the other view.
  useEffect(() => {
    if (selected && (!selectedSlot || (selected.pageIndex === COVER) !== (view === 'cover'))) setSelected(undefined);
    if (swapFrom && !pages[swapFrom.pageIndex]) setSwapFrom(undefined);
  }, [pages, selected, selectedSlot, swapFrom, view]);

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

  // Fit the spread (or the cover sheet) to the canvas.
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

  // Lulu's exact sheet size once a cover was rendered with Lulu connected (M5); the caliper estimate until then.
  const luluGeometry = renders.data?.find((r) => r.kind === 'cover' && r.status === 'done' && r.data?.cover?.geometry.source === 'lulu' && r.data.cover.pageCount === pages.length)?.data?.cover?.geometry;
  const geometry = useMemo(() => luluGeometry ?? coverGeometry(format, book.luluProduct, pages.length), [luluGeometry, format, book.luluProduct, pages.length]);
  const coverScale = Math.min(1, (canvasSize.w - 112) / (geometry.widthIn * PX_PER_IN), (canvasSize.h - 72) / (geometry.heightIn * PX_PER_IN));

  /* ---------- Direct manipulation ---------- */

  /** Frame patch of the slot being dragged, drawn live and committed on release. */
  const [live, setLive] = useState<{ ref: SlotRef; patch: FramePatch } | undefined>();
  const withLive = useCallback(
    (list: { templateId: string; slots: SlotContent[] }, pageIndex: number): SlotContent[] => {
      if (!live || live.ref.pageIndex !== pageIndex) return list.slots;
      const frame = currentFrame(list, live.ref.slotId);
      if (!frame) return list.slots;
      return slotsSetFrame(list, live.ref.slotId, { ...frame, ...live.patch });
    },
    [live],
  );
  const livePages = useMemo(() => (live && live.ref.pageIndex !== COVER ? pages.map((p, i) => (i === live.ref.pageIndex ? { ...p, slots: withLive(p, i) } : p)) : pages), [pages, live, withLive]);
  const liveCover = useMemo(() => (live && live.ref.pageIndex === COVER && doc.cover ? { ...doc.cover, slots: withLive(doc.cover, COVER) } : doc.cover), [doc.cover, live, withLive]);

  const commitFrame = useCallback(
    (ref: SlotRef, patch: FramePatch, coalesce?: string) => {
      if (ref.pageIndex === COVER) {
        setHistory((h) => {
          const cover = h.present.cover;
          const frame = cover ? coverFrame(cover, ref.slotId) : undefined;
          if (!cover || !frame) return h;
          return historyPush(h, { ...h.present, cover: withCoverSlots(cover, (c) => slotsSetFrame(c, ref.slotId, { ...frame, ...patch })) }, coalesce ? { key: coalesce } : undefined);
        });
        return;
      }
      setHistory((h) => {
        const page = h.present.pages[ref.pageIndex];
        const frame = page ? currentFrame(page, ref.slotId) : undefined;
        if (!page || !frame) return h;
        return historyPush(h, { ...h.present, pages: setFrame(h.present.pages, ref, { ...frame, ...patch }) }, coalesce ? { key: coalesce } : undefined);
      });
    },
    [],
  );

  const surfaceHost = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [dragRef, setDragRef] = useState<SlotRef | undefined>();
  /** Geometry of the page (or cover) a slot reference points at, from the given document state. */
  const surfaceFor = useCallback(
    (ref: SlotRef, pagesNow: readonly Page[], coverNow: BookCover | undefined): DesignSurface => {
      const empty: DesignSurface = { width: 1, height: 1, boxes: [], guides: [], bounds: { x: 0, y: 0, w: 1, h: 1 }, toFrame: (r) => r };
      if (ref.pageIndex !== COVER) {
        const page = pagesNow[ref.pageIndex];
        return page ? pageSurface(page, format, page.index % 2 === 0 ? 'right' : 'left') : empty;
      }
      if (!coverNow) return empty;
      const sheetW = Math.round(geometry.widthIn * PX_PER_IN);
      const sheetH = Math.round(geometry.heightIn * PX_PER_IN);
      const boxes: SurfaceBox[] = effectiveSlots(coverNow.templateId, coverNow.slots)
        .filter((s) => s.spec.id !== 'spine' && s.spec.role !== 'map' && s.spec.role !== 'qr')
        .map((s) => {
          const rect = coverSlotPx(s.spec, format, geometry);
          return {
            id: s.spec.id,
            rect,
            rotation: s.frame.rotation ?? 0,
            kind: s.spec.role === 'hero' || s.spec.role === 'photo' ? 'photo' : s.spec.role === 'folio' ? 'rule' : 'text',
            ratio: s.spec.role === 'hero' || s.spec.role === 'photo' ? rect.w / rect.h : undefined,
          };
        });
      return {
        width: sheetW,
        height: sheetH,
        boxes,
        guides: coverSnapLines(format, geometry).map((l) => ({ ...l, at: l.at * PX_PER_IN })),
        bounds: { x: 0, y: 0, w: sheetW, h: sheetH },
        toFrame: (r) => {
          const tl = coverPxToUnits(r.x, r.y, format, geometry);
          return { x: tl.x, y: tl.y, w: r.w / (format.trimWidthIn * PX_PER_IN), h: r.h / (format.trimHeightIn * PX_PER_IN) };
        },
      };
    },
    [format, geometry],
  );
  const dragSurface = useMemo<DesignSurface>(
    () => (dragRef ? surfaceFor(dragRef, livePages, liveCover) : { width: 1, height: 1, boxes: [], guides: [], bounds: { x: 0, y: 0, w: 1, h: 1 }, toFrame: (r) => r }),
    [dragRef, livePages, liveCover, surfaceFor],
  );

  const drag = useDesignDrag(
    dragSurface,
    dragRef?.pageIndex === COVER ? coverScale : scale,
    (id, patch, phase) => {
      const ref = dragRef?.slotId === id ? dragRef : undefined;
      if (!ref) return;
      if (phase === 'move') setLive((cur) => ({ ref, patch: { ...(cur && cur.ref.slotId === id ? cur.patch : {}), ...patch } }));
      else {
        setLive((cur) => {
          if (cur && cur.ref.slotId === id) commitFrame(ref, cur.patch);
          return undefined;
        });
      }
    },
    () => surfaceHost.current.get(dragRef?.pageIndex ?? COVER) ?? null,
  );

  const onSlotPointerDown = (pageIndex: number) => (slot: SlotSpec, _content: SlotContent | undefined, e: ReactPointerEvent<HTMLElement>) => {
    if (slot.role === 'map' || slot.role === 'qr') return;
    const ref: SlotRef = { pageIndex, slotId: slot.id };
    setDragRef(ref);
    if (pageIndex !== COVER) setFocusIndex(pageIndex);
    // The drag prevents the pointer default (no text selection), which would also skip focusing the
    // slot; focus it by hand so the arrow keys nudge it and the panel inputs let go of the keyboard.
    e.currentTarget.focus({ preventScroll: true });
    // The hook's own surface catches up on the next render; the drag starts from the current one.
    drag.startMove(slot.id, e, surfaceFor(ref, pages, doc.cover));
  };

  const onSlotClick = (pageIndex: number) => (slot: SlotSpec, content: SlotContent | undefined) => {
    const ref: SlotRef = { pageIndex, slotId: slot.id };
    if (pageIndex !== COVER) setFocusIndex(pageIndex);
    const isPhoto = slot.role === 'hero' || slot.role === 'photo';
    if (!isPhoto) {
      setSwapFrom(undefined);
      setSelected(ref);
      return;
    }
    if (pageIndex === COVER) {
      setSelected(ref);
      return;
    }
    if (swapFrom) {
      apply(swapSlots(pages, swapFrom, ref));
      setSwapFrom(undefined);
      setSelected(content?.assetId || pages[swapFrom.pageIndex]?.slots.find((s) => s.slotId === swapFrom.slotId)?.assetId ? ref : undefined);
      return;
    }
    if (content?.assetId) setSelected(ref);
    else if (selected && selected.pageIndex !== COVER && selectedSlot && (selectedSlot.spec.role === 'hero' || selectedSlot.spec.role === 'photo') && selectedSlot.content?.assetId) {
      // Clicking an empty slot with a photo selected moves it there.
      apply(swapSlots(pages, selected, ref));
      setSelected(ref);
    } else setSelected(ref);
  };

  /* ---------- Operations on the selection ---------- */

  const selectedIsPhoto = selectedSlot ? selectedSlot.spec.role === 'hero' || selectedSlot.spec.role === 'photo' : false;
  const selectedIsText = selectedSlot ? isTextRole(selectedSlot.spec.role) : false;
  const selectedAsset = selectedSlot?.content?.assetId ? assetMap.get(selectedSlot.content.assetId) : undefined;
  const selectedContent = selectedSlot?.content;
  const selectedPpi =
    selectedAsset?.width && selectedAsset.height && selectedSlot && selectedIsPhoto
      ? effectivePpi(
          selectedAsset.width,
          selectedAsset.height,
          selected?.pageIndex === COVER ? coverSlotPx(selectedSlot.spec, format, geometry).w / PX_PER_IN : selectedSlot.spec.w * format.trimWidthIn,
          selected?.pageIndex === COVER ? coverSlotPx(selectedSlot.spec, format, geometry).h / PX_PER_IN : selectedSlot.spec.h * format.trimHeightIn,
          selectedContent?.crop,
        )
      : undefined;

  /** Runs a slot-list operation on the selected slot's page or on the cover. */
  const onSelection = useCallback(
    (pageOp: (pages: Page[], ref: SlotRef) => Page[], coverOp: (cover: BookCover, slotId: string) => BookCover, coalesce?: string) => {
      if (!selected) return;
      if (selected.pageIndex === COVER) {
        if (doc.cover) applyCover(coverOp(doc.cover, selected.slotId), coalesce);
      } else apply(pageOp(pages, selected), coalesce);
    },
    [selected, doc.cover, pages, apply, applyCover],
  );

  const removeSelected = useCallback(() => {
    if (!selected || !selectedSlot) return;
    if (selected.pageIndex === COVER) {
      if (doc.cover) applyCover(withCoverSlots(doc.cover, (c) => slotsDelete(c, selected.slotId)));
    } else if (selectedSlot.adHoc || !selectedIsPhoto) apply(deleteSlot(pages, selected));
    else apply(removePhoto(pages, selected, ratios));
    setSelected(undefined);
  }, [selected, selectedSlot, selectedIsPhoto, doc.cover, pages, ratios, apply, applyCover]);

  const nudgeSelected = useCallback(
    (dxIn: number, dyIn: number) => {
      if (!selected) return;
      onSelection(
        (p, ref) => nudgeSlot(p, ref, dxIn, dyIn, format),
        (c, id) => withCoverSlots(c, (l) => slotsNudge(l, id, dxIn / format.trimWidthIn, dyIn / format.trimHeightIn)),
        `nudge:${selected.pageIndex}:${selected.slotId}`,
      );
    },
    [selected, onSelection, format],
  );

  const duplicateSelected = useCallback(() => {
    if (!selected || !selectedSlot?.adHoc || selectedSlot.spec.role !== 'text') return;
    if (selected.pageIndex === COVER) {
      if (!doc.cover) return;
      const r = slotsDuplicate(doc.cover, selected.slotId, format);
      applyCover({ ...doc.cover, slots: r.slots });
      if (r.slotId) setSelected({ pageIndex: COVER, slotId: r.slotId });
    } else {
      const r = duplicateSlot(pages, selected, format);
      apply(r.pages);
      if (r.slotId) setSelected({ pageIndex: selected.pageIndex, slotId: r.slotId });
    }
  }, [selected, selectedSlot, doc.cover, pages, format, apply, applyCover]);

  const addText = useCallback(() => {
    if (view === 'cover') {
      if (!doc.cover) return;
      const r = slotsAddText({ ...doc.cover, slots: doc.cover.slots }, '', { x: 0.1, y: 0.3, w: 0.8, h: 0.12 });
      applyCover({ ...doc.cover, slots: r.slots });
      setSelected({ pageIndex: COVER, slotId: r.slotId });
      return;
    }
    if (!focusPage) return;
    const r = addTextBox(pages, focusPageIndex);
    apply(r.pages);
    if (r.slotId) setSelected({ pageIndex: focusPageIndex, slotId: r.slotId });
  }, [view, doc.cover, focusPage, focusPageIndex, pages, apply, applyCover]);

  // Keyboard: arrows page through spreads (or nudge the selection), Delete removes, Esc clears,
  // Ctrl+Z/Y undo/redo, ]/[ stack, Ctrl+D duplicates, T adds a text box, ? shows the help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key.startsWith('Arrow') && selected) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_SHIFT_IN : NUDGE_IN;
        nudgeSelected(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      } else if (e.key === 'ArrowLeft') {
        if (view === 'cover') return;
        if (spreadIndex === 0 && hasCover) gotoCover();
        else gotoSpread(spreadIndex - 1);
      } else if (e.key === 'ArrowRight') {
        if (view === 'cover') gotoSpread(0);
        else gotoSpread(spreadIndex + 1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      else if (e.key === ']' && selected) onSelection((p, ref) => setZ(p, ref, 'front'), (c, id) => withCoverSlots(c, (l) => slotsSetZ(l, id, 'front')));
      else if (e.key === '[' && selected) onSelection((p, ref) => setZ(p, ref, 'back'), (c, id) => withCoverSlots(c, (l) => slotsSetZ(l, id, 'back')));
      else if (e.key.toLowerCase() === 't' && !mod) addText();
      else if (e.key === '?') setHelp((h) => !h);
      else if (e.key === 'Escape') {
        setHelp(false);
        setSwapFrom(undefined);
        setSelected(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, gotoSpread, gotoCover, spreadIndex, removeSelected, selected, nudgeSelected, onSelection, duplicateSelected, addText, view, hasCover]);

  const focusPhotos = focusPage ? pageAssetIds(focusPage).map((id) => ({ id, ratio: ratios.get(id) ?? 1.5 })) : [];
  const templateChoices = focusPage && isFlexiblePage(focusPage) && !focusPage.custom && focusPhotos.length > 0 ? templatesForPhotos(focusPhotos) : [];
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

  /** Text of the selected text slot: the stored override, else what the page or cover would print. */
  const selectedText = selectedIsText ? (selectedContent?.text ?? '') : undefined;
  const selectedTextPlaceholder = selected && selectedSlot && !selectedSlot.adHoc && selected.pageIndex === COVER && doc.cover ? coverText({ ...doc.cover, slots: doc.cover.slots.filter((s) => s.slotId !== selected.slotId) }, selected.slotId, meta) || 'Type here' : undefined;
  const setSelectedText = (text: string) => {
    if (!selected || !selectedSlot) return;
    const key = `text:${selected.pageIndex}:${selected.slotId}`;
    if (selected.pageIndex === COVER) {
      if (!doc.cover) return;
      const clear = !selectedSlot.adHoc && text === '';
      applyCover(withCoverSlots(doc.cover, (l) => (clear ? slotsUnsetText(l, selected.slotId) : slotsSetText(l, selected.slotId, text))), key);
    } else if (selectedSlot.adHoc) apply(setBoxText(pages, selected, text), key);
    else apply(setSlotText(pages, selected.pageIndex, selected.slotId, text), key);
  };

  const slotOverlay = (ctx: SlotOverlayContext) => {
    if (!ctx.asset) return <span className="slot-empty">{swapFrom || (selectedIsPhoto && selectedAsset) ? 'Move here' : 'Empty'}</span>;
    if (!ctx.asset.width || !ctx.asset.height) return null;
    const ppi = effectivePpi(ctx.asset.width, ctx.asset.height, ctx.wIn, ctx.hIn, ctx.content?.crop);
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
    const shown = livePages[page.index] ?? page;
    const surface = dragRef?.pageIndex === page.index ? dragSurface : pageSurface(shown, format, side);
    return (
      <div
        className={`page-frame${isFocus ? ' page-frame--focus' : ''}`}
        ref={(el) => {
          surfaceHost.current.set(page.index, el);
        }}
      >
        <PageView
          page={shown}
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
          onSlotPointerDown={onSlotPointerDown(page.index)}
          onBackgroundClick={() => {
            setFocusIndex(page.index);
            setSelected(undefined);
          }}
          slotOverlay={slotOverlay}
        />
        <DesignOverlay surface={surface} scale={scale} selectedId={selected?.pageIndex === page.index ? selected.slotId : undefined} drag={drag} />
        {page.custom ? (
          <span className="page-frame__badge" title="Laid out by hand: re-layout leaves this page alone">
            Custom
          </span>
        ) : null}
      </div>
    );
  };

  const renderCover = () => {
    if (!liveCover) return null;
    const surface = dragRef?.pageIndex === COVER ? dragSurface : surfaceFor({ pageIndex: COVER, slotId: '' }, livePages, liveCover);
    return (
      <div
        className="page-frame page-frame--focus"
        ref={(el) => {
          surfaceHost.current.set(COVER, el);
        }}
      >
        <CoverView
          cover={liveCover}
          geometry={geometry}
          format={format}
          theme={theme}
          assets={assetMap}
          imageSrc={PREVIEW_SRC}
          meta={meta}
          scale={coverScale}
          guides
          selectedSlotId={selected?.pageIndex === COVER ? selected.slotId : undefined}
          onSlotClick={onSlotClick(COVER)}
          onSlotPointerDown={onSlotPointerDown(COVER)}
          onBackgroundClick={() => setSelected(undefined)}
        />
        <DesignOverlay surface={surface} scale={coverScale} selectedId={selected?.pageIndex === COVER ? selected.slotId : undefined} drag={drag} />
      </div>
    );
  };

  const latestRender = renders.data?.[0];
  const activeRender = renders.data?.find(isActiveRender);
  const saveState = save.isError ? 'error' : save.isPending ? 'saving' : dirty ? 'dirty' : 'saved';
  const customCount = pages.filter((p) => p.custom).length;

  const relayout = () => {
    const kept = customCount > 0 ? ` ${customCount} hand-designed page${customCount === 1 ? ' is' : 's are'} kept as ${customCount === 1 ? 'it is' : 'they are'}.` : '';
    if (!window.confirm(`Lay the book out again? Every page edit is replaced by a fresh automatic layout of the same photos.${kept}`)) return;
    layout.mutate(
      { refetch: false },
      {
        onSuccess: (res) => {
          const next = docOf(res.book);
          savedRef.current = next;
          knownServerDoc.current = docKey(next);
          setHistory({ present: next, past: [], future: [] });
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

  const selectedFrame = selectedSlot?.frame;
  const selectionPanel =
    selected && selectedSlot && selectedFrame ? (
      <DesignPanel
        kind={selectedIsPhoto ? 'photo' : selectedSlot.spec.role === 'folio' ? 'rule' : 'text'}
        adHoc={selectedSlot.adHoc}
        frame={selectedFrame}
        format={format}
        onFrame={(patch) => commitFrame(selected, patch)}
        onZ={(where) => onSelection((p, ref) => setZ(p, ref, where), (c, id) => withCoverSlots(c, (l) => slotsSetZ(l, id, where)))}
        onDuplicate={selectedSlot.adHoc && selectedSlot.spec.role === 'text' ? duplicateSelected : undefined}
        onDelete={removeSelected}
        deleteLabel={selectedIsPhoto ? (selectedSlot.adHoc ? 'Remove box' : 'Remove') : selectedSlot.adHoc ? 'Delete box' : 'Hide'}
        text={
          selectedIsText
            ? {
                value: selectedText ?? '',
                placeholder: selectedTextPlaceholder ?? (selectedSlot.adHoc ? 'Type here' : 'Automatic text'),
                onChange: setSelectedText,
                style: selectedContent?.style,
                onStyle: (style) => onSelection((p, ref) => setTextStyle(p, ref, style), (c, id) => withCoverSlots(c, (l) => slotsSetTextStyle(l, id, style))),
              }
            : undefined
        }
      />
    ) : null;

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
            {view === 'cover' ? `Cover · spine ${geometry.spineIn.toFixed(2)} in (${luluGeometry ? 'Lulu' : 'est.'})` : `Spread ${spreadIndex + 1} of ${spreads.length}${spread ? ` · ${spreadLabel(spread)}` : ''}`}
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className={`savestate savestate--${saveState}`} role="status">
            {saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'error' ? `Save failed: ${errorMessage(save.error)}` : 'Saved'}
          </span>
          <Button variant="ghost" icon="undo" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={history.past.length === 0} />
          <Button variant="ghost" icon="redo" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={redo} disabled={history.future.length === 0} />
          <Button variant="ghost" icon="info" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)} />
          <span className="editor__sep" />
          <Button icon="layout" onClick={relayout} loading={layout.isPending} title="Automatic layout again (replaces your edits; hand-designed pages are kept)">
            Re-lay out
          </Button>
          {activeRender ? (
            <Chip tone="amber">
              {activeRender.status === 'queued' ? 'Queued' : `Rendering ${activeRender.pagesDone}/${activeRender.pagesTotal}`}
            </Chip>
          ) : latestRender?.status === 'done' && latestRender.downloadUrl ? (
            <a className="btn" href={latestRender.downloadUrl} target="_blank" rel="noreferrer" title={`Open the latest ${latestRender.kind} PDF`}>
              <Icon name="download" size={16} />
              {latestRender.kind === 'print' ? 'Print PDF' : latestRender.kind === 'cover' ? 'Cover PDF' : 'Proof PDF'}
            </a>
          ) : latestRender?.status === 'error' ? (
            <Chip tone="red">PDF failed</Chip>
          ) : null}
          <RenderButtons bookId={book.id} disabled={dirty || save.isPending} disabledReason={dirty ? 'Wait for the save to finish' : undefined} />
        </div>
      </header>

      <div className="editor__body">
        <nav className="filmstrip" aria-label="Spreads">
          {hasCover && doc.cover ? (
            <button type="button" className={`film${view === 'cover' ? ' film--on' : ''}`} onClick={gotoCover} aria-current={view === 'cover' ? 'true' : undefined} aria-label="Cover">
              <span className="film__pages">
                <CoverView cover={doc.cover} geometry={geometry} format={format} theme={theme} assets={assetMap} imageSrc={THUMB_SRC} meta={meta} scale={120 / (geometry.widthIn * PX_PER_IN)} />
              </span>
              <span className="film__label mono">cover</span>
            </button>
          ) : null}
          {spreads.map((sp) => (
            <button
              key={sp.index}
              type="button"
              className={`film${view === 'spread' && sp.index === spreadIndex ? ' film--on' : ''}`}
              onClick={() => gotoSpread(sp.index)}
              aria-current={view === 'spread' && sp.index === spreadIndex ? 'true' : undefined}
              aria-label={`Spread ${sp.index + 1}, ${spreadLabel(sp)}${chapterOpening(sp) ? `, opens ${chapterOpening(sp)!.title}` : ''}${sp.left?.custom || sp.right?.custom ? ', custom layout' : ''}`}
            >
              {chapterOpening(sp) ? <span className="film__chapter">{chapterOpening(sp)!.title}</span> : null}
              <span className="film__pages">
                {sp.left ? <PageView page={sp.left} format={format} theme={theme} assets={assetMap} imageSrc={THUMB_SRC} meta={meta} side="left" scale={0.07} /> : <span className="film__blank" />}
                {sp.right ? <PageView page={sp.right} format={format} theme={theme} assets={assetMap} imageSrc={THUMB_SRC} meta={meta} side="right" scale={0.07} /> : <span className="film__blank" />}
              </span>
              <span className="film__label mono">
                {sp.leftNumber !== undefined && sp.rightNumber !== undefined ? `${sp.leftNumber}–${sp.rightNumber}` : (sp.leftNumber ?? sp.rightNumber)}
                {sp.left?.custom || sp.right?.custom ? <span className="film__custom" title="Custom layout"> ✎</span> : null}
              </span>
            </button>
          ))}
        </nav>

        <div className="canvas" ref={canvasRef}>
          <button
            type="button"
            className="canvas__nav canvas__nav--prev"
            onClick={() => (view === 'spread' && spreadIndex === 0 && hasCover ? gotoCover() : gotoSpread(spreadIndex - 1))}
            disabled={view === 'cover' || (spreadIndex === 0 && !hasCover)}
            aria-label={spreadIndex === 0 ? 'Cover' : 'Previous spread'}
          >
            <Icon name="chevronLeft" />
          </button>
          {view === 'cover' ? (
            <div className="spread">{renderCover()}</div>
          ) : spread ? (
            <div className="spread" style={{ gap: 0 }}>
              {renderPage(spread.left, 'left', spread.leftNumber)}
              {renderPage(spread.right, 'right', spread.rightNumber)}
            </div>
          ) : null}
          <button
            type="button"
            className="canvas__nav canvas__nav--next"
            onClick={() => (view === 'cover' ? gotoSpread(0) : gotoSpread(spreadIndex + 1))}
            disabled={view === 'spread' && spreadIndex >= spreads.length - 1}
            aria-label="Next spread"
          >
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
          {view === 'cover' ? (
            <div className="canvas__folios mono muted">
              <span>back</span>
              <span className="canvas__folio-line" />
              <span>front</span>
            </div>
          ) : (
            <div className="canvas__folios mono muted">
              {spread?.leftNumber !== undefined ? <span>{spread.leftNumber}</span> : <span />}
              <span className="canvas__folio-line" />
              {spread?.rightNumber !== undefined ? <span>{spread.rightNumber}</span> : <span />}
            </div>
          )}
        </div>

        <aside className="panel" aria-label="Page tools">
          {layout.isError ? (
            <Note tone="error" role="alert">
              Re-layout failed: {errorMessage(layout.error)}
            </Note>
          ) : null}

          {view === 'cover' && doc.cover ? (
            <section className="panel__section">
              <div className="row row--between">
                <div className="label">Cover</div>
                <span className="muted small">{luluGeometry ? 'Lulu sheet size' : 'estimated spine'}</span>
              </div>
              <div className="muted small">Back cover on the left, spine in the middle, front on the right. Drag the photo and the texts anywhere; the spine text stays on the spine. Title, subtitle, spine and back-cover texts are also on the book page.</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <Button size="sm" variant="ghost" icon="plus" onClick={addText} title="Add a text box to the cover (T)">
                  Text box
                </Button>
              </div>
            </section>
          ) : focusPage ? (
            <section className="panel__section">
              <div className="row row--between">
                <div className="label">
                  Page {focusPageIndex + 1}
                  {focusPage.custom ? (
                    <Chip tone="amber" outline className="page-chip">
                      Custom
                    </Chip>
                  ) : null}
                </div>
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
              ) : focusPage.custom ? (
                <div className="muted small">Laid out by hand: drag any photo or text to move it, use the handles to resize or rotate, and add boxes below. Re-layout keeps this page.</div>
              ) : isFlexiblePage(focusPage) && focusPhotos.length > 0 ? (
                <div className="muted small">Only one template holds {focusPhotos.length} photos. Add or remove a photo for more choices, or drag a photo to design the page by hand.</div>
              ) : focusPage.templateId === 'chapter-photo' ? (
                <div className="muted small">The opener photo fills the page and faces the chapter title. Swap it with any photo, or remove it to leave the page empty.</div>
              ) : null}
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <Button size="sm" variant="ghost" icon="plus" onClick={addText} title="Add a text box to this page (T)">
                  Text box
                </Button>
                {focusPage.custom ? (
                  <Button size="sm" variant="ghost" icon="refresh" onClick={() => apply(resetPage(pages, focusPageIndex))} title="Drop every hand placement and draw the template again; photos in added boxes go back to the tray">
                    Reset to template
                  </Button>
                ) : null}
              </div>
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
            <div className="label">{selectedIsText ? 'Selected text' : selectedSlot && !selectedIsPhoto ? 'Selected rule' : 'Selected photo'}</div>
            {selected && selectedIsPhoto && selectedAsset ? (
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
                  <Note tone="amber">This photo has {Math.round(selectedPpi)} pixels per printed inch here; it will look soft. Make the box smaller or pick another shot.</Note>
                ) : null}
                {selectedContent?.crop ? (
                  <div className="row row--between small">
                    <span className="muted">
                      Framed on the faces ({Math.round(selectedContent.crop.focalX * 100)}%, {Math.round(selectedContent.crop.focalY * 100)}%)
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelection((p, ref) => setCrop(p, ref, undefined), (c, id) => ({ ...c, slots: c.slots.map((s) => (s.slotId === id ? omitKeys(s, 'crop') : s)) }))}
                      title="Back to the centred crop"
                    >
                      Centre
                    </Button>
                  </div>
                ) : null}
                {selected.pageIndex !== COVER ? (
                  <div className="row" style={{ gap: 8 }}>
                    <Button className="grow" icon="swap" onClick={() => setSwapFrom(selected)} aria-pressed={Boolean(swapFrom)} title="Then click another photo to exchange places">
                      Swap
                    </Button>
                  </div>
                ) : null}
                {selectionPanel}
              </>
            ) : selected && selectedSlot ? (
              <>
                {selectedIsPhoto ? <div className="muted small">An empty photo box. Click a photo in the tray to put it here, or drag the box where you want it.</div> : null}
                {selectionPanel}
              </>
            ) : (
              <div className="muted small">Click a photo or text on the page to move, resize or rotate it, swap it, or check its print resolution. Click an empty slot to move a selected photo there. Press ? for the shortcuts.</div>
            )}
          </section>

          {view === 'spread' && focusPage && hasCaption ? (
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

          {view === 'spread' ? (
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
                        const r = addPhoto(pages, focusPageIndex, a.id, ratios, undefined, format);
                        apply(r.pages);
                        setFocusIndex(r.pageIndex);
                        gotoPage(r.pageIndex);
                        if (r.slotId) setSelected({ pageIndex: r.pageIndex, slotId: r.slotId });
                      }}
                    >
                      <img src={thumbnailUrl(a.id)} alt={a.fileName ?? ''} loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          <section className="panel__section muted small" style={{ lineHeight: 1.5 }}>
            Drag to move, handles to resize, arrows to nudge. Delete removes the selection. Ctrl+Z undoes. Press ? for every shortcut. Changes save automatically.
          </section>
        </aside>
      </div>
      {help ? <ShortcutHelp onClose={() => setHelp(false)} /> : null}
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

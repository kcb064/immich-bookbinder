import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { BookFormat, SlotFrame, TextStyle } from '@bookbinder/shared';
import { PX_PER_IN } from '@bookbinder/shared';
import { DEFAULT_TEXT_STYLE, angleFromCentre, clampToBounds, resizeBy, slotSnapLines, snapAngle, snapAngleToBoxes, snapMove, snapResize, type Edges, type PxRect, type SnapLine } from '@bookbinder/layout';
import { Icon } from './Icon.tsx';
import { Button } from './ui.tsx';

/**
 * Direct manipulation for the designer (M6): a drag hook that turns pointer movement into frame
 * changes with snapping, an overlay that draws the selection handles and active guides, the
 * "Design" panel section and the keyboard shortcut overlay. Everything works in unscaled surface
 * pixels (96 per inch, origin = top-left of the page's bleed box or of the cover sheet); the
 * surface converts a pixel rect back to template units.
 */

export interface SurfaceBox {
  id: string;
  rect: PxRect;
  rotation: number;
  kind: 'photo' | 'text' | 'rule';
  /** Width / height to keep while resizing (photos); undefined = free. */
  ratio?: number | undefined;
}

export interface DesignSurface {
  width: number;
  height: number;
  boxes: SurfaceBox[];
  /** Static guides (trim, safety, centre, spine) in surface px. */
  guides: SnapLine[];
  /** The bleed box (or sheet) nothing may leave entirely. */
  bounds: PxRect;
  toFrame: (rect: PxRect) => Pick<SlotFrame, 'x' | 'y' | 'w' | 'h'>;
}

export type FramePatch = Partial<SlotFrame>;

export interface DragState {
  id: string;
  mode: 'move' | 'resize' | 'rotate';
}

/** Snap distance on screen, in CSS px. */
const SNAP_PX = 8;
const MIN_BOX_PX = 0.25 * PX_PER_IN;
const MIN_INSIDE_PX = 0.25 * PX_PER_IN;

/**
 * Re-imposes an aspect ratio after snapping: the axis a guide hit (else the wider change) leads,
 * the other follows, anchored on the edges that are not being dragged like {@link resizeBy}.
 */
function keepRatio(rect: PxRect, origin: PxRect, edges: Edges, ratio: number, hits: readonly SnapLine[]): PxRect {
  const horizontal = Boolean(edges.left || edges.right);
  const vertical = Boolean(edges.top || edges.bottom);
  const byWidth = horizontal && (!vertical || hits.some((l) => l.axis === 'x') || !hits.some((l) => l.axis === 'y'));
  let { w, h } = rect;
  if (byWidth) h = w / ratio;
  else w = h * ratio;
  let x = rect.x;
  let y = rect.y;
  if (edges.left) x = origin.x + origin.w - w;
  if (edges.top) y = origin.y + origin.h - h;
  if (!horizontal) x = origin.x + (origin.w - w) / 2;
  if (!vertical) y = origin.y + (origin.h - h) / 2;
  return { x, y, w, h };
}

interface Session {
  id: string;
  mode: 'move' | 'resize' | 'rotate';
  startX: number;
  startY: number;
  origin: PxRect;
  rotation: number;
  edges: Edges;
  ratio: number | undefined;
  centre: { x: number; y: number };
  moved: boolean;
}

export interface DesignDrag {
  /** `surface` overrides the hook's surface for this drag's start (the hook's own catches up on the next render). */
  startMove: (id: string, e: ReactPointerEvent<HTMLElement> | PointerEvent, surface?: DesignSurface) => void;
  startResize: (id: string, edges: Edges, e: ReactPointerEvent<HTMLElement>) => void;
  startRotate: (id: string, e: ReactPointerEvent<HTMLElement>) => void;
  /** Guides the dragged box currently sits on. */
  lines: SnapLine[];
  active: DragState | undefined;
}

/**
 * Pointer drags over a surface. `onChange` fires with the live patch while dragging and once more
 * with `phase: 'end'` on release (the caller commits that one to history). Alt unlocks a photo's
 * aspect, Shift disables snapping.
 */
export function useDesignDrag(surface: DesignSurface, scale: number, onChange: (id: string, patch: FramePatch, phase: 'move' | 'end') => void, surfaceEl: () => HTMLElement | null): DesignDrag {
  const session = useRef<Session | undefined>(undefined);
  const [lines, setLines] = useState<SnapLine[]>([]);
  const [active, setActive] = useState<DragState | undefined>();
  const latest = useRef({ surface, scale, onChange });
  latest.current = { surface, scale, onChange };

  const begin = useCallback(
    (id: string, mode: Session['mode'], edges: Edges, e: { clientX: number; clientY: number; button?: number; preventDefault: () => void }, surface?: DesignSurface) => {
      if (e.button !== undefined && e.button !== 0) return;
      const s = surface ?? latest.current.surface;
      const sc = latest.current.scale;
      const box = s.boxes.find((b) => b.id === id);
      if (!box) return;
      e.preventDefault();
      const host = surfaceEl()?.getBoundingClientRect();
      const centre = host ? { x: host.left + (box.rect.x + box.rect.w / 2) * sc, y: host.top + (box.rect.y + box.rect.h / 2) * sc } : { x: e.clientX, y: e.clientY };
      session.current = { id, mode, startX: e.clientX, startY: e.clientY, origin: box.rect, rotation: box.rotation, edges, ratio: box.ratio, centre, moved: false };
      setActive({ id, mode });
    },
    [surfaceEl],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = session.current;
      if (!st) return;
      const { surface: s, scale: sc, onChange: emit } = latest.current;
      const dx = (e.clientX - st.startX) / sc;
      const dy = (e.clientY - st.startY) / sc;
      if (!st.moved && Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 3) return;
      st.moved = true;
      const threshold = SNAP_PX / sc;
      const guides = e.shiftKey ? [] : [...s.guides, ...slotSnapLines(s.boxes.filter((b) => b.id !== st.id).map((b) => b.rect))];
      if (st.mode === 'rotate') {
        const raw = angleFromCentre(st.centre, { x: e.clientX, y: e.clientY });
        // Snap to the tilt of another box first (so two photos line up), else to the 15° grid.
        const others = s.boxes.filter((b) => b.id !== st.id && b.rotation).map((b) => b.rotation);
        const snapped = e.shiftKey ? { angle: Math.round(raw * 10) / 10, matched: undefined } : snapAngleToBoxes(raw, others);
        setLines(snapped.matched !== undefined ? s.boxes.filter((b) => b.id !== st.id && Math.round(b.rotation * 10) / 10 === snapped.matched).map((b) => ({ kind: 'slot' as const, axis: 'x' as const, at: b.rect.x + b.rect.w / 2 })) : []);
        emit(st.id, { rotation: snapped.angle }, 'move');
        return;
      }
      let rect: PxRect;
      let hits: SnapLine[] = [];
      if (st.mode === 'move') {
        const moved = { ...st.origin, x: st.origin.x + dx, y: st.origin.y + dy };
        const snapped = snapMove(moved, guides, threshold);
        rect = clampToBounds(snapped.rect, s.bounds, MIN_INSIDE_PX);
        hits = snapped.hits;
      } else {
        const ratio = st.ratio && !e.altKey ? st.ratio : undefined;
        const resized = resizeBy(st.origin, st.edges, dx, dy, ratio, MIN_BOX_PX);
        const snapped = snapResize(resized, st.edges, guides, threshold, MIN_BOX_PX);
        // Aspect-locked boxes snap too: the snapped edge leads and the other dimension follows the ratio.
        rect = ratio ? keepRatio(snapped.rect, st.origin, st.edges, ratio, snapped.hits) : snapped.rect;
        hits = snapped.hits;
      }
      setLines(hits);
      emit(st.id, s.toFrame(rect), 'move');
    };
    const onUp = () => {
      const st = session.current;
      if (!st) return;
      session.current = undefined;
      setLines([]);
      setActive(undefined);
      if (st.moved) latest.current.onChange(st.id, {}, 'end');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return {
    startMove: (id, e, surface) => begin(id, 'move', {}, e, surface),
    startResize: (id, edges, e) => begin(id, 'resize', edges, e),
    startRotate: (id, e) => begin(id, 'rotate', {}, e),
    lines,
    active,
  };
}

const HANDLES: Array<{ key: string; edges: Edges; cursor: string; x: number; y: number }> = [
  { key: 'nw', edges: { left: true, top: true }, cursor: 'nwse-resize', x: 0, y: 0 },
  { key: 'n', edges: { top: true }, cursor: 'ns-resize', x: 0.5, y: 0 },
  { key: 'ne', edges: { right: true, top: true }, cursor: 'nesw-resize', x: 1, y: 0 },
  { key: 'e', edges: { right: true }, cursor: 'ew-resize', x: 1, y: 0.5 },
  { key: 'se', edges: { right: true, bottom: true }, cursor: 'nwse-resize', x: 1, y: 1 },
  { key: 's', edges: { bottom: true }, cursor: 'ns-resize', x: 0.5, y: 1 },
  { key: 'sw', edges: { left: true, bottom: true }, cursor: 'nesw-resize', x: 0, y: 1 },
  { key: 'w', edges: { left: true }, cursor: 'ew-resize', x: 0, y: 0.5 },
];

export interface DesignOverlayProps {
  surface: DesignSurface;
  scale: number;
  selectedId: string | undefined;
  drag: DesignDrag;
  /** Crop mode: the box is fixed and drags move the picture inside it, so no handles. */
  cropping?: boolean | undefined;
}

/** Selection box, resize and rotation handles, and the snap guides in play, drawn over a page or the cover. */
export function DesignOverlay({ surface, scale, selectedId, drag, cropping = false }: DesignOverlayProps) {
  const box = selectedId ? surface.boxes.find((b) => b.id === selectedId) : undefined;
  return (
    <div className="design-overlay" style={{ width: surface.width * scale, height: surface.height * scale }} aria-hidden="true">
      {drag.lines.map((l, i) => (
        <div
          key={`${l.axis}${l.at}${i}`}
          className={`design-guide design-guide--${l.kind}`}
          style={l.axis === 'x' ? { left: l.at * scale, top: 0, width: 1, height: '100%' } : { top: l.at * scale, left: 0, height: 1, width: '100%' }}
        />
      ))}
      {box ? (
        <div
          className={`design-sel${drag.active ? ' design-sel--dragging' : ''}${cropping ? ' design-sel--crop' : ''}`}
          style={{ left: box.rect.x * scale, top: box.rect.y * scale, width: box.rect.w * scale, height: box.rect.h * scale, transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }}
        >
          {box.kind === 'rule' || cropping
            ? null
            : HANDLES.map((h) => (
                <span key={h.key} className="design-handle" style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }} onPointerDown={(e) => drag.startResize(box.id, h.edges, e)} />
              ))}
          {cropping ? null : (
            <span className="design-rotate" onPointerDown={(e) => drag.startRotate(box.id, e)} title="Drag to rotate (snaps to 15°)">
              <Icon name="refresh" size={12} />
            </span>
          )}
          {drag.active && drag.active.id === box.id ? (
            <span className="design-readout mono">
              {drag.active.mode === 'rotate'
                ? `${box.rotation.toFixed(0)}°`
                : `${(box.rect.w / PX_PER_IN).toFixed(2)} × ${(box.rect.h / PX_PER_IN).toFixed(2)} in`}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Panel ---------- */

export interface DesignPanelProps {
  kind: 'photo' | 'text' | 'rule';
  /** True for boxes the template does not know (deletable, duplicable). */
  adHoc: boolean;
  frame: SlotFrame;
  /** Inches per template unit on each axis. */
  format: BookFormat;
  onFrame: (patch: FramePatch) => void;
  onZ: (where: 'front' | 'back') => void;
  onDuplicate?: (() => void) | undefined;
  onDelete: () => void;
  deleteLabel: string;
  /** Text boxes and template text slots. */
  text?: { value: string; placeholder?: string | undefined; onChange: (text: string) => void; style: TextStyle | undefined; onStyle: (style: TextStyle | undefined) => void } | undefined;
}

function NumberField({ label, value, step, onCommit, suffix }: { label: string; value: number; step: number; onCommit: (v: number) => void; suffix: string }) {
  const [draft, setDraft] = useState<string | undefined>();
  useEffect(() => setDraft(undefined), [value]);
  const commit = () => {
    if (draft === undefined) return;
    const v = Number(draft);
    if (Number.isFinite(v) && Math.abs(v - value) > 1e-6) onCommit(v);
    setDraft(undefined);
  };
  return (
    <label className="design-num">
      <span className="design-num__label">{label}</span>
      <input
        className="input design-num__input mono"
        type="number"
        step={step}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
        aria-label={`${label} (${suffix})`}
      />
      <span className="design-num__unit muted">{suffix}</span>
    </label>
  );
}

/** Position, size, rotation, stacking and (for text) content and style of the selected slot. */
export function DesignPanel({ kind, adHoc, frame, format, onFrame, onZ, onDuplicate, onDelete, deleteLabel, text }: DesignPanelProps) {
  const wIn = format.trimWidthIn;
  const hIn = format.trimHeightIn;
  const style = text?.style ?? DEFAULT_TEXT_STYLE;
  const setStyle = (patch: Partial<TextStyle>) => text?.onStyle({ ...style, ...patch });
  return (
    <div className="stack" style={{ gap: 10 }}>
      {text ? (
        <>
          <textarea
            className="input caption-input"
            rows={3}
            value={text.value}
            placeholder={text.placeholder ?? 'Type here'}
            aria-label="Text"
            onChange={(e) => text.onChange(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="design-style">
            <select className="input design-style__font" value={style.font} onChange={(e) => setStyle({ font: e.target.value as TextStyle['font'] })} aria-label="Font">
              <option value="body">Body face</option>
              <option value="display">Display face</option>
            </select>
            <NumberField label="Size" value={style.sizePt} step={1} suffix="pt" onCommit={(v) => setStyle({ sizePt: Math.max(6, Math.min(144, v)) })} />
            <div className="seg" role="group" aria-label="Alignment">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} type="button" className={`seg__btn${style.align === a ? ' seg__btn--on' : ''}`} onClick={() => setStyle({ align: a })} aria-pressed={style.align === a} title={`Align ${a}`}>
                  {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                </button>
              ))}
            </div>
            <button type="button" className={`seg__btn seg__btn--solo${style.italic ? ' seg__btn--on' : ''}`} onClick={() => setStyle({ italic: !style.italic })} aria-pressed={style.italic} title="Italic">
              <i>I</i>
            </button>
          </div>
          {!adHoc && text.style ? (
            <button type="button" className="link-btn small" onClick={() => text.onStyle(undefined)}>
              Use the template's own style
            </button>
          ) : null}
        </>
      ) : null}
      <div className="design-grid">
        <NumberField label="X" value={frame.x * wIn} step={0.05} suffix="in" onCommit={(v) => onFrame({ x: v / wIn })} />
        <NumberField label="Y" value={frame.y * hIn} step={0.05} suffix="in" onCommit={(v) => onFrame({ y: v / hIn })} />
        <NumberField label="W" value={frame.w * wIn} step={0.05} suffix="in" onCommit={(v) => onFrame({ w: Math.max(0.25, v) / wIn })} />
        <NumberField label="H" value={frame.h * hIn} step={0.05} suffix="in" onCommit={(v) => onFrame({ h: Math.max(0.25, v) / hIn })} />
        <NumberField label="Rotate" value={frame.rotation ?? 0} step={1} suffix="°" onCommit={(v) => onFrame({ rotation: snapAngle(v, 1, 0) })} />
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <Button size="sm" variant="ghost" onClick={() => onZ('front')} title="Bring to front (])">
          Front
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onZ('back')} title="Send to back ([)">
          Back
        </Button>
        {onDuplicate ? (
          <Button size="sm" variant="ghost" onClick={onDuplicate} title="Duplicate (Ctrl+D)">
            Duplicate
          </Button>
        ) : null}
        <Button size="sm" variant="danger" icon={kind === 'photo' ? 'x' : 'trash'} onClick={onDelete} title={`${deleteLabel} (Delete)`}>
          {deleteLabel}
        </Button>
      </div>
    </div>
  );
}

/* ---------- Shortcut help ---------- */

export const SHORTCUTS: ReadonlyArray<[keys: string, what: string]> = [
  ['← →', 'Previous / next spread (with nothing selected)'],
  ['Tab, Enter', 'Move focus between slots and select one'],
  ['Shift+click', 'Add a box to the selection (nudge, restack and delete act on all of them)'],
  ['Drag from the tray', 'Drop a photo onto a slot to put it there, or anywhere on the page for a new photo box'],
  ['Arrows', 'Nudge the selected slot 0.1 in (Shift: 0.5 in)'],
  ['Drag', 'Move; handles resize (Alt frees a photo’s aspect, Shift skips snapping); top handle rotates'],
  ['C', 'Adjust the crop of the selected photo: drag the picture inside its box, arrows nudge it (Shift: more), Esc leaves'],
  ['] / [', 'Bring to front / send to back'],
  ['T', 'Add a text box to the focused page'],
  ['Ctrl+D', 'Duplicate the selected text box'],
  ['Delete', 'Remove the selected photo or box'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Esc', 'Clear the selection, close this list'],
  ['?', 'Show this list'],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-backdrop" role="presentation" onClick={onClose}>
      <div className="help card" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <div className="row row--between">
          <h2 id="help-title" className="help__title">
            Keyboard shortcuts
          </h2>
          <Button variant="ghost" icon="x" aria-label="Close" onClick={onClose} autoFocus />
        </div>
        <dl className="help__list">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="help__row">
              <dt className="mono">{keys}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

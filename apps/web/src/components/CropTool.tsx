import { useCallback, useEffect, useRef, useState } from 'react';
import type { Crop } from '@bookbinder/shared';
import { CROP_MAX_ZOOM, isDefaultCrop, panCrop } from '@bookbinder/layout';
import { Button } from './ui.tsx';

/**
 * The crop tool: with a filled photo box selected, "Adjust crop" turns the drag from moving the box
 * into moving the picture inside it (the focal point), a slider sets the zoom and the arrow keys
 * nudge. The box never changes, so the layout stays put. Pure math lives in `@bookbinder/layout`
 * (`panCrop`, `zoomCrop`, `cropImageStyle`); this file does the pointer work and the panel.
 */

export interface CropDragStart {
  /** Crop before the drag (undefined = centred default). */
  crop: Crop | undefined;
  /** width / height of the photo and of its box. */
  srcRatio: number;
  slotRatio: number;
  /** Box size on screen in CSS px, and its tilt in degrees. */
  boxPx: { w: number; h: number };
  rotation: number;
}

export interface CropDrag {
  start: (id: string, e: { clientX: number; clientY: number; button?: number; preventDefault: () => void }, at: CropDragStart) => void;
  /** Id of the slot whose picture is being dragged. */
  activeId: string | undefined;
}

interface Session extends CropDragStart {
  id: string;
  startX: number;
  startY: number;
  last: Crop | undefined;
}

/**
 * Pointer drags that pan a photo inside its box. `onChange` fires with the live crop while dragging
 * and once more with `phase: 'end'` on release (the caller commits that one to history).
 */
export function useCropDrag(onChange: (id: string, crop: Crop, phase: 'move' | 'end') => void): CropDrag {
  const session = useRef<Session | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | undefined>();
  const latest = useRef(onChange);
  latest.current = onChange;

  const start = useCallback<CropDrag['start']>((id, e, at) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    session.current = { ...at, id, startX: e.clientX, startY: e.clientY, last: undefined };
    setActiveId(id);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = session.current;
      if (!st) return;
      let dx = e.clientX - st.startX;
      let dy = e.clientY - st.startY;
      if (!st.last && Math.hypot(dx, dy) < 3) return;
      // A tilted box: express the pointer movement in the box's own axes.
      if (st.rotation) {
        const a = (-st.rotation * Math.PI) / 180;
        [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
      }
      st.last = panCrop(st.crop, dx / st.boxPx.w, dy / st.boxPx.h, st.srcRatio, st.slotRatio);
      latest.current(st.id, st.last, 'move');
    };
    const onUp = () => {
      const st = session.current;
      if (!st) return;
      session.current = undefined;
      setActiveId(undefined);
      if (st.last) latest.current(st.id, st.last, 'end');
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

  return { start, activeId };
}

export interface CropPanelProps {
  crop: Crop | undefined;
  /** Crop mode is on: drags on the selected photo pan the picture. */
  active: boolean;
  onToggle: () => void;
  /** Live while the slider moves; the caller coalesces the history steps. */
  onZoom: (zoom: number) => void;
  onReset: () => void;
}

/** "Adjust crop" toggle, zoom slider and reset for the selected photo. */
export function CropPanel({ crop, active, onToggle, onZoom, onReset }: CropPanelProps) {
  const zoom = crop?.zoom ?? 1;
  return (
    <div className="stack crop-panel" style={{ gap: 6 }}>
      <div className="row row--between">
        <Button size="sm" variant={active ? 'primary' : 'ghost'} icon="crop" onClick={onToggle} aria-pressed={active} title="Move the picture inside its box (C)">
          {active ? 'Done cropping' : 'Adjust crop'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset} disabled={isDefaultCrop(crop)} title="Back to the centred crop">
          Reset
        </Button>
      </div>
      <label className="row small crop-panel__zoom" style={{ gap: 8 }}>
        <span className="muted">Zoom</span>
        <input
          type="range"
          min={1}
          max={CROP_MAX_ZOOM}
          step={0.05}
          value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Zoom"
          style={{ flex: 1, minWidth: 0 }}
        />
        <span className="mono">{zoom.toFixed(2)}×</span>
      </label>
      {active ? (
        <div className="muted small">Drag the picture to choose what shows; arrows nudge it (Shift: bigger steps). Esc when done.</div>
      ) : crop && !isDefaultCrop(crop) ? (
        <div className="muted small">
          Focus {Math.round(crop.focalX * 100)}%, {Math.round(crop.focalY * 100)}%{zoom > 1 ? ` at ${zoom.toFixed(2)}×` : ''}
        </div>
      ) : null}
    </div>
  );
}

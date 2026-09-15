/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, PointerEvent } from 'react';
import type { BookAsset, BookCover, BookFormat, CoverGeometry, SlotContent, SlotSpec, Theme } from '@bookbinder/shared';
import { PX_PER_IN } from '@bookbinder/shared';
import { MIN_SPINE_TEXT_IN, effectiveSlots, getTemplate, objectPosition } from '@bookbinder/layout';
import { activateOnKey, frameTransform, textBoxStyle, type BookMeta, type ImageSrc } from './PageView.js';

export interface CoverViewProps {
  cover: BookCover;
  geometry: CoverGeometry;
  format: BookFormat;
  theme: Theme;
  assets: ReadonlyMap<string, BookAsset>;
  imageSrc: ImageSrc;
  meta: BookMeta;
  /** 1 = 96 CSS px per inch (print size). */
  scale?: number | undefined;
  /** Draw the trim, spine and wrap guides (admin preview only). */
  guides?: boolean | undefined;
  /** Designer hooks (M6), as on PageView. */
  selectedSlotId?: string | undefined;
  onSlotClick?: ((slot: SlotSpec, content: SlotContent | undefined) => void) | undefined;
  onSlotPointerDown?: ((slot: SlotSpec, content: SlotContent | undefined, event: PointerEvent<HTMLElement>) => void) | undefined;
  onBackgroundClick?: (() => void) | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/** Text a cover slot shows: the stored override, else the book's own title, dates and spine text. */
export function coverText(cover: BookCover, slotId: string, meta: BookMeta): string {
  const stored = cover.slots.find((s) => s.slotId === slotId)?.text;
  if (stored !== undefined) return stored;
  switch (slotId) {
    case 'title':
      return meta.title;
    case 'subtitle':
      return meta.subtitle ?? meta.dateRange;
    case 'back-blurb':
      return cover.blurb ?? '';
    case 'spine':
      return cover.spineText ?? meta.title;
    default:
      return '';
  }
}

/** Template x/y of a point on the cover sheet (inverse of the mapping in {@link coverSlotPx}); the spine maps to x = 0. */
export function coverPxToUnits(px: number, py: number, format: BookFormat, g: CoverGeometry, ppi = PX_PER_IN): { x: number; y: number } {
  const trimW = format.trimWidthIn * ppi;
  const trimH = format.trimHeightIn * ppi;
  const wrap = g.wrapIn * ppi;
  const spine = g.spineIn * ppi;
  const x = px < wrap + trimW ? (px - wrap) / trimW - 1 : px < wrap + trimW + spine ? 0 : (px - wrap - trimW - spine) / trimW;
  return { x, y: (py - wrap) / trimH };
}

/** Pixel box of a cover slot on the sheet: back cover left, spine, then front; bleed slots run to the sheet edge. */
export function coverSlotPx(slot: Pick<SlotSpec, 'id' | 'x' | 'y' | 'w' | 'h'>, format: BookFormat, g: CoverGeometry, ppi = PX_PER_IN): { x: number; y: number; w: number; h: number } {
  const trimW = format.trimWidthIn * ppi;
  const trimH = format.trimHeightIn * ppi;
  const wrap = g.wrapIn * ppi;
  const spine = g.spineIn * ppi;
  const sheetW = g.widthIn * ppi;
  const sheetH = g.heightIn * ppi;
  const eps = 1e-6;
  // Template x is in trim widths: back [-1, 0], front [0, 1]; the spine is inserted at 0.
  const mapX = (u: number): number => {
    if (u <= -1 - eps) return 0;
    if (u >= 1 + eps) return sheetW;
    return u <= 0 ? wrap + (u + 1) * trimW : wrap + trimW + spine + u * trimW;
  };
  const mapY = (v: number): number => (v <= -eps ? 0 : v >= 1 + eps ? sheetH : wrap + v * trimH);
  if (slot.id === 'spine') return { x: Math.round(wrap + trimW), y: Math.round(wrap), w: Math.round(spine), h: Math.round(trimH) };
  const x0 = mapX(slot.x);
  const x1 = mapX(slot.x + slot.w);
  const y0 = mapY(slot.y);
  const y1 = mapY(slot.y + slot.h);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/** Title size that fits `text` on one line of `w` px in the italic display face, capped by the slot height. */
function fitTitle(text: string, w: number, h: number): number {
  const byHeight = h * 0.85;
  const byWidth = text.length > 0 ? w / (0.48 * text.length) : byHeight;
  return Math.max(24, Math.round(Math.min(byHeight, byWidth)));
}

/**
 * Draws the whole cover sheet (back, spine, front, wrap) at 96 CSS px per inch times `scale`. The
 * hero photo wraps the sheet; text sits on the front over a soft scrim, the blurb on the back, and
 * the spine text reads bottom-to-top once the spine is wide enough. Same markup for the admin
 * preview and the PDF.
 */
export function CoverView({ cover, geometry: g, format, theme, assets, imageSrc, meta, scale = 1, guides = false, selectedSlotId, onSlotClick, onSlotPointerDown, onBackgroundClick, className, style }: CoverViewProps) {
  const template = getTemplate(cover.templateId);
  const slots = effectiveSlots(cover.templateId, cover.slots);
  const photoSlots = slots.filter((s) => s.spec.role === 'hero' || s.spec.role === 'photo');
  const textSlots = slots.filter((s) => s.spec.role !== 'hero' && s.spec.role !== 'photo' && s.spec.role !== 'map' && s.spec.role !== 'qr');
  const interactive = Boolean(onSlotClick);
  const designing = Boolean(onSlotPointerDown);
  const hooksFor = (slot: SlotSpec, content: SlotContent | undefined, label: string) => {
    if (!interactive) return {};
    const activate = () => onSlotClick?.(slot, content);
    return {
      onClick: (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        activate();
      },
      onPointerDown: onSlotPointerDown ? (e: PointerEvent<HTMLElement>) => onSlotPointerDown(slot, content, e) : undefined,
      onKeyDown: activateOnKey(activate),
      role: 'button' as const,
      tabIndex: 0,
      'aria-label': label,
    };
  };
  const ppi = PX_PER_IN;
  const sheetW = Math.round(g.widthIn * ppi);
  const sheetH = Math.round(g.heightIn * ppi);
  const hero = template.slots.find((s) => s.role === 'hero');
  const heroContent = hero ? cover.slots.find((s) => s.slotId === hero.id) : undefined;
  const heroAsset = heroContent?.assetId ? assets.get(heroContent.assetId) : undefined;
  const onPhoto = Boolean(heroAsset);
  const ink = onPhoto ? theme.paper : theme.ink;
  const shadow = onPhoto ? '0 1px 3px rgba(0,0,0,0.45), 0 0 24px rgba(0,0,0,0.25)' : undefined;
  const frontLeft = Math.round(g.frontLeftIn * ppi);
  const wrap = Math.round(g.wrapIn * ppi);
  const trimW = Math.round(format.trimWidthIn * ppi);
  const trimH = Math.round(format.trimHeightIn * ppi);
  const spineW = Math.round(g.spineIn * ppi);

  const outer: CSSProperties = {
    position: 'relative',
    width: sheetW * scale,
    height: sheetH * scale,
    overflow: 'hidden',
    background: theme.paper,
    color: ink,
    flex: 'none',
    ...style,
  };
  const inner: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: sheetW,
    height: sheetH,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    transformOrigin: '0 0',
    fontFamily: theme.bodyFont,
  };

  return (
    <div className={['bb-cover', className].filter(Boolean).join(' ')} style={outer} data-template={template.id} data-spine-in={g.spineIn}>
      <div className="bb-cover__inner" style={inner} onClick={onBackgroundClick}>
        {photoSlots.map(({ spec: slot, content, frame, z, adHoc }) => {
          const r = coverSlotPx(slot, format, g, ppi);
          const asset = content?.assetId ? assets.get(content.assetId) : undefined;
          const selected = selectedSlotId === slot.id;
          return (
            <div
              key={slot.id}
              className={['bb-slot', asset ? 'bb-slot--filled' : 'bb-slot--empty', selected ? 'bb-slot--selected' : '', adHoc ? 'bb-slot--adhoc' : ''].filter(Boolean).join(' ')}
              data-slot-id={slot.id}
              {...hooksFor(slot, content, asset ? `Photo ${asset.fileName ?? asset.id}` : `Empty slot ${slot.id}`)}
              style={{
                position: 'absolute',
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                overflow: 'hidden',
                ...frameTransform(frame, z),
                cursor: interactive ? (designing ? 'move' : 'pointer') : undefined,
                outline: selected ? '3px solid #7c8cff' : undefined,
                outlineOffset: selected ? -3 : undefined,
              }}
            >
              {asset ? (
                <img
                  src={imageSrc({ asset, wIn: r.w / ppi, hIn: r.h / ppi, crop: content?.crop })}
                  alt=""
                  draggable={false}
                  style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: objectPosition(content?.crop) }}
                />
              ) : null}
            </div>
          );
        })}
        {onPhoto ? (
          // A soft scrim over the lower part of the photo keeps the title, dates and blurb legible on bright scenes.
          <div
            aria-hidden="true"
            style={{ position: 'absolute', left: 0, top: 0, width: sheetW, height: sheetH, background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 30%, rgba(0,0,0,0) 55%)', pointerEvents: 'none' }}
          />
        ) : null}
        {textSlots.map(({ spec: slot, content, frame, z, adHoc }) => {
          const r = coverSlotPx(slot, format, g, ppi);
          const selected = selectedSlotId === slot.id;
          const base: CSSProperties = { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, ...frameTransform(frame, z) };
          const textHooks = designing && slot.id !== 'spine' ? hooksFor(slot, content, `Text ${slot.id}`) : {};
          const textOutline: CSSProperties = designing && slot.id !== 'spine' ? { cursor: 'move', outline: selected ? '2px solid #7c8cff' : undefined, outlineOffset: 2 } : {};
          const text = adHoc ? (content?.text ?? '') : coverText(cover, slot.id, meta);
          if (slot.id === 'spine') {
            if (!text || g.spineIn < MIN_SPINE_TEXT_IN) return null;
            // A horizontal box as long as the spine, rotated so the text reads bottom-to-top.
            // Half an inch of margin at each end; the glyph height stays well inside the spine width.
            const size = Math.max(9, Math.min(Math.round(r.w * 0.55), Math.floor((r.h - 96) / (0.48 * text.length))));
            return (
              <div
                key={slot.id}
                className="bb-text bb-text--spine"
                data-slot-id={slot.id}
                style={{
                  position: 'absolute',
                  left: r.x + r.w / 2 - r.h / 2,
                  top: r.y + r.h / 2 - r.w / 2,
                  width: r.h,
                  height: r.w,
                  transform: 'rotate(-90deg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: theme.displayFont,
                  fontStyle: 'italic',
                  fontWeight: 300,
                  fontSize: size,
                  lineHeight: 1,
                  letterSpacing: '0.02em',
                  color: ink,
                  textShadow: shadow,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                {text}
              </div>
            );
          }
          if (slot.role === 'folio') {
            if (!coverText(cover, 'title', meta)) return null;
            return <div key={slot.id} className="bb-rule" data-slot-id={slot.id} {...textHooks} style={{ ...base, background: onPhoto ? ink : theme.accent, boxShadow: shadow, ...textOutline }} />;
          }
          if (!text && !designing) return null;
          const styles: CSSProperties =
            content?.style || adHoc
              ? textBoxStyle(theme, content?.style, ink)
              : slot.role === 'title'
                ? { fontFamily: theme.displayFont, fontStyle: 'italic', fontWeight: 300, fontSize: fitTitle(text, r.w, r.h), lineHeight: 1, letterSpacing: '-0.02em', display: 'flex', alignItems: 'flex-end' }
                : slot.role === 'caption'
                  ? { fontFamily: theme.bodyFont, fontStyle: theme.captionItalic ? 'italic' : 'normal', fontSize: theme.captionSizePx + 2, lineHeight: 1.45, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }
                  : { fontFamily: theme.bodyFont, fontSize: 14, lineHeight: 1.55 };
          return (
            <div
              key={slot.id}
              className={['bb-text', `bb-text--${slot.role}`, adHoc ? 'bb-text--box' : '', !text ? 'bb-text--empty' : ''].filter(Boolean).join(' ')}
              data-slot-id={slot.id}
              {...textHooks}
              style={{ ...base, ...styles, color: ink, textShadow: shadow, overflow: 'hidden', ...textOutline }}
            >
              {slot.role === 'title' && !adHoc ? <span style={{ display: 'block', width: '100%' }}>{text}</span> : text}
            </div>
          );
        })}
        {guides ? (
          <>
            <div style={{ position: 'absolute', left: wrap, top: wrap, width: trimW, height: trimH, outline: '1px solid rgba(220,60,60,0.7)', outlineOffset: -1, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: frontLeft, top: wrap, width: trimW, height: trimH, outline: '1px solid rgba(220,60,60,0.7)', outlineOffset: -1, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: wrap + trimW, top: 0, width: spineW, height: sheetH, background: 'rgba(60,120,220,0.12)', pointerEvents: 'none' }} />
          </>
        ) : null}
      </div>
    </div>
  );
}

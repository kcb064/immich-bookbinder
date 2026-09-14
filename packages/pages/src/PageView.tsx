/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from 'react';
import type { BookAsset, BookFormat, Crop, Page, SlotContent, SlotSpec, Template, Theme } from '@bookbinder/shared';
import { PX_PER_IN } from '@bookbinder/shared';
import { getTemplate, objectPosition, pagePx, slotToPx } from '@bookbinder/layout';
import { autoCaption, photographsLabel } from './captions.js';

/** Book-level text the templates can draw (title page, running captions). */
export interface BookMeta {
  title: string;
  subtitle?: string | undefined;
  photoCount: number;
  /** "May 12 – 21, 2026" or "" */
  dateRange: string;
}

/** What a photo slot needs from the image provider: the asset and the printed slot size in inches. */
export interface SlotImageRequest {
  asset: BookAsset;
  wIn: number;
  hIn: number;
  crop: Crop | undefined;
}
export type ImageSrc = (req: SlotImageRequest) => string;

export interface SlotOverlayContext {
  slot: SlotSpec;
  content: SlotContent | undefined;
  asset: BookAsset | undefined;
  /** Printed slot size in inches. */
  wIn: number;
  hIn: number;
}

export interface PageViewProps {
  page: Page;
  format: BookFormat;
  theme: Theme;
  assets: ReadonlyMap<string, BookAsset>;
  imageSrc: ImageSrc;
  meta: BookMeta;
  /** Which side of the spread this page sits on; affects folio placement. Default 'right'. */
  side?: 'left' | 'right' | undefined;
  /** Printed page number to show as a folio; omit for none (title page, blanks). */
  folio?: number | undefined;
  /** 1 = 96 CSS px per inch (print size). The editor passes a fraction. */
  scale?: number | undefined;
  /** Draw trim and safety guides (editor only). */
  guides?: boolean | undefined;
  /** Editor hooks. */
  selectedSlotId?: string | undefined;
  onSlotClick?: ((slot: SlotSpec, content: SlotContent | undefined) => void) | undefined;
  onBackgroundClick?: (() => void) | undefined;
  /** Renders extra UI on top of a photo slot (ppi badges, empty-slot hints). */
  slotOverlay?: ((ctx: SlotOverlayContext) => ReactNode) | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export function templateFor(page: Page): Template {
  return getTemplate(page.templateId);
}

export function photoSlotsOf(template: Template): SlotSpec[] {
  return template.slots.filter((s) => s.role === 'hero' || s.role === 'photo');
}

/** Photos on a page in slot order (undefined where a slot is empty). */
export function pagePhotos(page: Page, assets: ReadonlyMap<string, BookAsset>): (BookAsset | undefined)[] {
  const t = templateFor(page);
  return photoSlotsOf(t).map((s) => {
    const c = page.slots.find((x) => x.slotId === s.id);
    return c?.assetId ? assets.get(c.assetId) : undefined;
  });
}

function textFor(template: Template, slot: SlotSpec, content: SlotContent | undefined, page: Page, assets: ReadonlyMap<string, BookAsset>, meta: BookMeta): string {
  if (content?.text !== undefined) return content.text;
  if (template.id === 'title-page') {
    if (slot.id === 'title') return meta.title;
    if (slot.id === 'subtitle') return meta.subtitle ?? [meta.dateRange, photographsLabel(meta.photoCount)].filter(Boolean).join(' · ');
    return '';
  }
  if (slot.role === 'caption') return autoCaption(pagePhotos(page, assets));
  return '';
}

function textStyle(theme: Theme, template: Template, slot: SlotSpec, h: number): CSSProperties {
  switch (slot.role) {
    case 'title': {
      const size = template.id === 'title-page' ? Math.round(h * 0.56) : Math.round(h * 0.9);
      return {
        fontFamily: theme.displayFont,
        fontStyle: 'italic',
        fontWeight: 300,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '-0.02em',
        color: theme.ink,
        display: 'flex',
        alignItems: 'flex-end',
        overflow: 'hidden',
      };
    }
    case 'caption':
      return {
        fontFamily: theme.bodyFont,
        fontStyle: theme.captionItalic ? 'italic' : 'normal',
        fontSize: theme.captionSizePx,
        lineHeight: 1.45,
        color: theme.caption,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      };
    case 'text':
      return { fontFamily: theme.bodyFont, fontSize: 15, lineHeight: 1.6, color: theme.ink, overflow: 'hidden' };
    case 'folio':
      return { background: theme.accent };
    default:
      return {};
  }
}

/**
 * Draws one page at 96 CSS px per inch (times `scale`), origin at the top-left of the bleed box.
 * Pure and deterministic: the same markup serves the editor, the viewer and the PDF renderer.
 */
export function PageView({
  page,
  format,
  theme,
  assets,
  imageSrc,
  meta,
  side = 'right',
  folio,
  scale = 1,
  guides = false,
  selectedSlotId,
  onSlotClick,
  onBackgroundClick,
  slotOverlay,
  className,
  style,
}: PageViewProps) {
  const template = templateFor(page);
  const size = pagePx(format, PX_PER_IN);
  const bleed = format.bleedIn * PX_PER_IN;
  const safety = format.safetyIn * PX_PER_IN;
  const trimW = format.trimWidthIn * PX_PER_IN;
  const trimH = format.trimHeightIn * PX_PER_IN;
  const contentById = new Map(page.slots.map((s) => [s.slotId, s]));
  const interactive = Boolean(onSlotClick);

  const outer: CSSProperties = {
    position: 'relative',
    width: size.w * scale,
    height: size.h * scale,
    overflow: 'hidden',
    background: theme.paper,
    color: theme.ink,
    flex: 'none',
    ...style,
  };
  const inner: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: size.w,
    height: size.h,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    transformOrigin: '0 0',
    fontFamily: theme.bodyFont,
  };

  return (
    <div className={['bb-page', className].filter(Boolean).join(' ')} style={outer} data-template={template.id} data-page-index={page.index}>
      <div className="bb-page__inner" style={inner} onClick={onBackgroundClick}>
        {template.slots.map((slot) => {
          const r = slotToPx(slot, format, PX_PER_IN);
          const content = contentById.get(slot.id);
          const base: CSSProperties = { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h };
          const wIn = slot.w * format.trimWidthIn;
          const hIn = slot.h * format.trimHeightIn;

          if (slot.role === 'hero' || slot.role === 'photo') {
            const asset = content?.assetId ? assets.get(content.assetId) : undefined;
            const selected = selectedSlotId === slot.id;
            return (
              <div
                key={slot.id}
                className={['bb-slot', asset ? 'bb-slot--filled' : 'bb-slot--empty', selected ? 'bb-slot--selected' : ''].filter(Boolean).join(' ')}
                data-slot-id={slot.id}
                style={{
                  ...base,
                  overflow: 'hidden',
                  background: asset ? undefined : 'rgba(0,0,0,0.05)',
                  cursor: interactive ? 'pointer' : undefined,
                  outline: selected ? '3px solid #7c8cff' : undefined,
                  outlineOffset: selected ? -3 : undefined,
                }}
                onClick={
                  interactive
                    ? (e) => {
                        e.stopPropagation();
                        onSlotClick?.(slot, content);
                      }
                    : undefined
                }
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? (asset ? `Photo ${asset.fileName ?? asset.id}` : `Empty slot ${slot.id}`) : undefined}
              >
                {asset ? (
                  <img
                    src={imageSrc({ asset, wIn, hIn, crop: content?.crop })}
                    alt=""
                    draggable={false}
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: objectPosition(content?.crop) }}
                  />
                ) : null}
                {slotOverlay ? slotOverlay({ slot, content, asset, wIn, hIn }) : null}
              </div>
            );
          }

          if (slot.role === 'map' || slot.role === 'qr') return null;

          const text = textFor(template, slot, content, page, assets, meta);
          if (slot.role === 'folio') return <div key={slot.id} className="bb-rule" style={{ ...base, ...textStyle(theme, template, slot, r.h) }} />;
          if (!text) return null;
          return (
            <div key={slot.id} className={`bb-text bb-text--${slot.role}`} data-slot-id={slot.id} style={{ ...base, ...textStyle(theme, template, slot, r.h) }}>
              {slot.role === 'title' ? <span style={{ display: 'block', width: '100%' }}>{text}</span> : text}
            </div>
          );
        })}

        {template.id === 'title-page' && meta.title ? (
          <div
            aria-hidden="true"
            style={{ position: 'absolute', left: bleed + safety, top: bleed + trimH * 0.405 + 96, width: 32, height: 1, background: theme.ink }}
          />
        ) : null}

        {folio !== undefined ? (
          <div
            className="bb-folio"
            style={{
              position: 'absolute',
              top: bleed + trimH - safety * 0.5 - 6,
              ...(side === 'left' ? { left: bleed + safety } : { right: bleed + safety }),
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              lineHeight: '12px',
              letterSpacing: '0.04em',
              color: theme.accent,
            }}
          >
            {folio}
          </div>
        ) : null}

        {guides ? (
          <>
            <div style={{ position: 'absolute', inset: 0, border: `${bleed}px solid rgba(220,60,60,0.10)`, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: bleed, top: bleed, width: trimW, height: trimH, outline: '1px solid rgba(220,60,60,0.55)', outlineOffset: -1, pointerEvents: 'none' }} />
            <div
              style={{
                position: 'absolute',
                left: bleed + safety,
                top: bleed + safety,
                width: trimW - 2 * safety,
                height: trimH - 2 * safety,
                border: '1px dashed rgba(60,120,220,0.5)',
                pointerEvents: 'none',
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

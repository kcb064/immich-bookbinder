import { useEffect, useState } from 'react';
import { FRAME_STYLE_LABELS, LOCALES, LOCALE_LABELS, THEMES, THEME_IDS, resolveTheme, type Book, type FrameStyle, type Locale, type ThemeOverrides } from '@bookbinder/shared';
import { Icon } from './Icon.tsx';
import { Button, Field, Note, Select } from './ui.tsx';
import { useSaveBook } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';

const CAPTION_SIZES = [10, 11, 12, 13, 14, 16, 18, 20];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Book page → Look (M7/M8): theme, per-book overrides, and the book's language. */
export function LookCard({ book }: { book: Book }) {
  const save = useSaveBook(book.id);
  const [themeId, setThemeId] = useState(book.themeId);
  const [overrides, setOverrides] = useState<ThemeOverrides>(book.themeOverrides ?? {});
  const [locale, setLocale] = useState<Locale>(book.locale ?? 'en');
  useEffect(() => {
    setThemeId(book.themeId);
    setOverrides(book.themeOverrides ?? {});
    setLocale(book.locale ?? 'en');
  }, [book.themeId, book.themeOverrides, book.locale]);

  const base = THEMES[themeId] ?? resolveTheme(themeId);
  const effective = resolveTheme(themeId, overrides);
  const dirty = themeId !== book.themeId || locale !== (book.locale ?? 'en') || JSON.stringify(overrides) !== JSON.stringify(book.themeOverrides ?? {});
  const hasOverrides = Object.keys(overrides).length > 0;

  const onSave = () => {
    const next: Book = { ...book, themeId, locale };
    if (hasOverrides) next.themeOverrides = overrides;
    else delete next.themeOverrides;
    save.mutate(next);
  };
  const set = (patch: Partial<ThemeOverrides>) =>
    setOverrides((o) => {
      const next = { ...o, ...patch };
      for (const k of Object.keys(next) as (keyof ThemeOverrides)[]) if (next[k] === undefined) delete next[k];
      return next;
    });

  return (
    <section className="card card--pad stack" aria-labelledby="look-title">
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <h2 className="h2" id="look-title">
          <Icon name="palette" size={16} /> Look
        </h2>
        <span className="look__swatch" style={{ background: effective.paper, color: effective.ink, fontFamily: effective.displayFont }} aria-hidden="true">
          Aa
        </span>
      </div>
      <div className="form-grid">
        <Field label="Book language" hint="Chapter titles, dates and captions printed in the book. The interface language lives in Settings.">
          {({ id }) => (
            <Select id={id} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Theme">
          {({ id }) => (
            <Select id={id} value={themeId} onChange={(e) => setThemeId(e.target.value)}>
              {THEME_IDS.map((tid) => (
                <option key={tid} value={tid}>
                  {THEMES[tid]!.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Photo frames">
          {({ id }) => (
            <Select id={id} value={overrides.frameStyle ?? ''} onChange={(e) => set({ frameStyle: e.target.value ? (e.target.value as FrameStyle) : undefined })}>
              <option value="">Theme default ({FRAME_STYLE_LABELS[base.frameStyle].toLowerCase()})</option>
              {(Object.keys(FRAME_STYLE_LABELS) as FrameStyle[]).map((fs) => (
                <option key={fs} value={fs}>
                  {FRAME_STYLE_LABELS[fs]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Paper colour" hint={overrides.paper ? 'Overriding the theme' : `Theme: ${base.paper}`}>
          {({ id }) => (
            <div className="row" style={{ gap: 8 }}>
              <input id={id} type="color" className="look__color" value={overrides.paper ?? base.paper} onChange={(e) => set({ paper: e.target.value.toLowerCase() === base.paper.toLowerCase() ? undefined : e.target.value })} aria-label="Paper colour" />
              {overrides.paper ? (
                <Button size="sm" variant="ghost" onClick={() => set({ paper: undefined })}>
                  Theme colour
                </Button>
              ) : null}
            </div>
          )}
        </Field>
        <ColorOverrideField
          label="Text colour"
          hint="Ink for titles, captions and text boxes on the pages"
          base={base.ink}
          value={overrides.ink}
          onChange={(v) => set({ ink: v })}
        />
        <ColorOverrideField
          label="Accent colour"
          hint="Rules, map routes and other accents"
          base={base.accent}
          value={overrides.accent}
          onChange={(v) => set({ accent: v })}
        />
        <ColorOverrideField
          label="Caption colour"
          hint="Small text: captions, dates, folios"
          base={base.caption}
          value={overrides.caption}
          onChange={(v) => set({ caption: v })}
        />
        <Field label="Caption size">
          {({ id }) => (
            <Select id={id} value={overrides.captionSizePx ?? ''} onChange={(e) => set({ captionSizePx: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Theme default ({base.captionSizePx} px)</option>
              {CAPTION_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {save.isError ? (
        <Note tone="error" role="alert">
          Could not save: {errorMessage(save.error)}
        </Note>
      ) : null}
      <div className="actions">
        <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty}>
          Apply
        </Button>
        {dirty ? (
          <Button
            variant="ghost"
            onClick={() => {
              setThemeId(book.themeId);
              setOverrides(book.themeOverrides ?? {});
              setLocale(book.locale ?? 'en');
            }}
          >
            Discard
          </Button>
        ) : null}
        <span className="muted small">Applies to the editor, the viewer and the next PDFs.</span>
      </div>
    </section>
  );
}

/** One colour override row: a colour picker plus a reset-to-theme button (M8). */
function ColorOverrideField({ label, hint, base, value, onChange }: { label: string; hint: string; base: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <Field label={label} hint={value ? 'Overriding the theme' : `${hint} · theme: ${base}`}>
      {({ id }) => (
        <div className="row" style={{ gap: 8 }}>
          <input
            id={id}
            type="color"
            className="look__color"
            value={HEX_RE.test(value ?? '') ? value! : base}
            onChange={(e) => onChange(e.target.value.toLowerCase() === base.toLowerCase() ? undefined : e.target.value)}
            aria-label={label}
          />
          {value ? (
            <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
              Theme colour
            </Button>
          ) : null}
        </div>
      )}
    </Field>
  );
}

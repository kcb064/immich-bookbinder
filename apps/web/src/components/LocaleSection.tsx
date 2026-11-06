import { LOCALES, LOCALE_LABELS, type Locale } from '@bookbinder/shared';
import { Icon } from './Icon.tsx';
import { Note, Select } from './ui.tsx';
import { useSaveUiLocale, useSettings } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';

/** Settings → Appearance (M8): the locale of the admin UI. Books carry their own locale separately. */
export function LocaleSection() {
  const settings = useSettings();
  const save = useSaveUiLocale();
  const locale: Locale = settings.data?.locale ?? 'en';

  return (
    <section className="card section" aria-labelledby="locale-title">
      <div className="section__head">
        <div>
          <h2 className="section__title" id="locale-title">
            <Icon name="settings" />
            Language
          </h2>
          <p className="section__desc">
            The language of this admin interface: dates, numbers and labels. Each book carries its own language separately — set it where the book is
            created or in its Look card — so the printed book can be German while the UI stays English, and the other way round.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Interface language</span>
          <Select
            value={locale}
            onChange={(e) => save.mutate(e.target.value as Locale)}
            aria-label="Interface language"
            disabled={save.isPending}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {save.isError ? (
        <Note tone="error" role="alert">
          Could not save: {errorMessage(save.error)}
        </Note>
      ) : null}
    </section>
  );
}

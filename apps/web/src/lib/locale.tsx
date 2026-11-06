import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { type Locale, normalizeLocale } from '@bookbinder/shared';
import { useSettings } from './queries.ts';

interface LocaleContextValue {
  locale: Locale;
  /** True until the server settings (with the stored locale) have loaded. */
  pending: boolean;
}

const LocaleContext = createContext<LocaleContextValue>({ locale: 'en', pending: true });

/**
 * The admin UI locale (M8): the server-stored setting when available, else the browser's locale,
 * else 'en'. Re-renderers pick it up through `useLocale`. Persisted changes go through
 * PUT /api/settings/locale (Settings page).
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const value = useMemo<LocaleContextValue>(() => {
    if (settings.data) return { locale: settings.data.locale, pending: false };
    if (typeof navigator !== 'undefined') return { locale: normalizeLocale(navigator.language), pending: true };
    return { locale: 'en', pending: true };
  }, [settings.data]);
  // Keep the document in sync so assistive tech and the viewer shell announce the right language.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = value.locale;
  }, [value.locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

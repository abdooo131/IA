'use client';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { AR } from './ar';

export type Locale = 'en' | 'ar';
const LocaleCtx = createContext<Locale>('en');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleCtx.Provider value={locale}>{children}</LocaleCtx.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleCtx);
}

/**
 * English text is the key; Arabic comes from lib/ar.ts. A missing Arabic string falls back to
 * English, so a new label never shows blank. `{name}` placeholders are filled from `vars`.
 */
export function useT() {
  const locale = useContext(LocaleCtx);
  return useCallback(
    (text: string, vars?: Record<string, string | number>) => {
      let out = locale === 'ar' ? (AR[text] ?? text) : text;
      if (vars)
        for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
      return out;
    },
    [locale],
  );
}

export function setPreference(name: 'shiply_locale' | 'shiply_theme', value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

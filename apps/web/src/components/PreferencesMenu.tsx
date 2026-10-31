'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { TicketsLink } from '@/components/tickets/TicketsLink';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  LOCALE_COOKIE,
  LOCALES,
  type Locale,
  THEME_COOKIE,
  THEMES,
  type Theme,
} from '@/lib/preferences';

const ONE_YEAR = 60 * 60 * 24 * 365;

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

const selectClass = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm text-text';

/** `theme` is the saved choice, read from the cookie on the server. */
/** `help` adds the Help link (signed in areas only; not on public pages). */
export function PreferencesMenu({ theme, help = false }: { theme: Theme; help?: boolean }) {
  const t = useTranslations('common');
  const ts = useTranslations('sop');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedTheme, setSelectedTheme] = useState(theme);

  function changeLocale(next: Locale) {
    setCookie(LOCALE_COOKIE, next);
    startTransition(() => router.refresh());
  }

  function changeTheme(next: Theme) {
    setCookie(THEME_COOKIE, next);
    setSelectedTheme(next);
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      {help && (
        <Link
          href="/help"
          className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold text-link"
        >
          {ts('menu')}
        </Link>
      )}
      {help && <TicketsLink />}
      <label className="sr-only" htmlFor="pref-locale">
        {t('language')}
      </label>
      <select
        id="pref-locale"
        className={selectClass}
        value={locale}
        onChange={(e) => changeLocale(e.target.value as Locale)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`localeOptions.${l}`)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="pref-theme">
        {t('theme')}
      </label>
      <select
        id="pref-theme"
        className={selectClass}
        value={selectedTheme}
        onChange={(e) => changeTheme(e.target.value as Theme)}
      >
        {THEMES.map((th) => (
          <option key={th} value={th}>
            {t(`themeOptions.${th}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

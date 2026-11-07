'use client';
import { useEffect, useState } from 'react';
import { setPreference, useLocale, useT } from '@/parcels/lib/i18n';

const selectClass = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm text-text';

/** Language and theme, the same two selects as Shiply Now. */
export function PreferencesMenu() {
  const t = useT();
  const locale = useLocale();
  const [theme, setTheme] = useState('system');
  useEffect(() => setTheme(document.documentElement.dataset.theme ?? 'system'), []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={t('Language')} className={selectClass} value={locale} onChange={(e) => setPreference('shiply_locale', e.target.value)}>
        <option value="en">English</option>
        <option value="ar">العربية</option>
      </select>
      <select aria-label={t('Theme')} className={selectClass} value={theme} onChange={(e) => setPreference('shiply_theme', e.target.value)}>
        <option value="system">{t('System')}</option>
        <option value="light">{t('Light')}</option>
        <option value="dark">{t('Dark')}</option>
      </select>
    </div>
  );
}

'use client';
import { Wordmark } from './Wordmark';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { TILES } from '@shiply/shared';
import { Link, usePathname } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Icon } from './Icon';
import { useMe } from './me';

export function TopBar({ children }: { children?: React.ReactNode }) {
  const t = useTranslations();
  const me = useMe();
  const locale = useLocale();
  const path = usePathname();
  const [appsOpen, setAppsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const apps = TILES.filter((a) => me.access[a] !== 'none');
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST', idempotent: false });
    window.location.assign(`/${locale}/login`);
  };
  return (
    <header className="topbar">
      <div className="topbar-row">
        <Link href="/" className="logo" aria-label="Shiply">
          <Wordmark size={24} />
        </Link>
        {children}
      </div>
      <div className="topbar-row tools">
        <label className="search">
          <Icon name="search" />
          <input type="search" placeholder={t('common.search')} aria-label={t('common.search')} />
        </label>
        <Link href={path} locale={locale === 'en' ? 'ar' : 'en'} className="btn ghost" data-testid="lang">
          {t('common.language')}
        </Link>
        <button className="btn ghost" aria-label={t('common.notifications')}>
          <Icon name="notifications" />
        </button>
        <div className="menu-anchor">
          <button className="btn ghost" onClick={() => setAppsOpen((o) => !o)} aria-expanded={appsOpen}>
            ⊞ {t('common.apps')}
          </button>
          {appsOpen && (
            <ul className="dropdown apps-dropdown" role="menu">
              {apps.map((a) => (
                <li key={a}>
                  <Link href={`/${a}`} onClick={() => setAppsOpen(false)}>
                    {t(`apps.${a}`)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="menu-anchor">
          <button className="btn ghost" onClick={() => setUserOpen((o) => !o)} aria-expanded={userOpen}>
            <Icon name="account" /> {locale === 'ar' ? me.nameAr : me.name}
          </button>
          {userOpen && (
            <ul className="dropdown" role="menu">
              <li>
                <button onClick={signOut}>{t('common.signOut')}</button>
              </li>
            </ul>
          )}
        </div>
      </div>
    </header>
  );
}

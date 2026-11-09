'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { AppId } from '@shiply/shared';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { TopBar } from '@/shell/TopBar';
import { useMe } from '@/shell/me';

interface HomeData {
  attention: { app: AppId; text: string; values?: Record<string, string | number>; href: string }[];
  numbers: { app: AppId; label: string; value: number; href: string }[];
  tiles: { app: AppId; count: number }[];
}

const ICONS: Record<AppId, string> = {
  shiply_now: 'courier', shiply: 'route', merchants: 'store', care: 'support', location: 'tracking',
  fleet: 'pickups', purchasing: 'packaging', accounting: 'wallet', hr: 'customers', sales: 'analytics',
  reports: 'analytics', settings: 'settings',
};

/** Each app's own colour, as in the old system; the new apps get colours of their own. */
const COLORS: Record<AppId, string> = {
  shiply_now: '#1D4ED8', shiply: '#0F766E', merchants: '#B45309', care: '#C2410C', location: '#0369A1',
  fleet: '#4D7C0F', purchasing: '#9333EA', accounting: '#15803D', hr: '#BE185D', sales: '#7C3AED',
  reports: '#082341', settings: '#475569',
};

export default function HomePage() {
  const t = useTranslations();
  const me = useMe();
  const locale = useLocale();
  const [data, setData] = useState<HomeData | null>(null);
  useEffect(() => {
    void api<HomeData>('/me/home').then(setData);
  }, []);
  return (
    <>
      <TopBar />
      <main className="page home">
        <h1 className="home-title">{t('home.hello', { name: locale === 'ar' ? me.nameAr : me.name })}</h1>
        <p className="home-intro muted">{t('home.intro')}</p>
        <section className="card">
          <h2>{t('home.attention')}</h2>
          {data && data.attention.length === 0 && <p className="muted">{t('home.nothingWaiting')}</p>}
          <ul className="attention">
            {data?.attention.map((a, i) => (
              <li key={i}>
                <Link href={a.href}>{t(a.text, a.values)}</Link>
              </li>
            ))}
          </ul>
        </section>
        {data && data.numbers.length > 0 && (
          <section className="numbers">
            <h2>{t('home.numbers')}</h2>
            <div className="number-row">
              {data.numbers.map((n) => (
                <Link key={n.label} href={n.href} className="card number">
                  <strong>{n.value}</strong>
                  <span>{t(n.label)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
        <section className="tiles" data-testid="tiles">
          {data?.tiles.map((x) => (
            <Link key={x.app} href={`/${x.app}`} className="tile" data-testid="tile">
              <span className="tile-icon" style={{ background: COLORS[x.app] }} aria-hidden="true">
                <svg width={32} height={32}>
                  <use href={`/brand/icons.svg#shiply-${ICONS[x.app]}`} />
                </svg>
              </span>
              <span className="tile-name">{t(`apps.${x.app}`)}</span>
              <span className="tile-desc">{t(`appDescriptions.${x.app}`)}</span>
              {x.count > 0 && <em className="badge">{x.count}</em>}
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}

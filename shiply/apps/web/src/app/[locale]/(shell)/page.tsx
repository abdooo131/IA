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
        <h1>{t('home.hello', { name: locale === 'ar' ? me.nameAr : me.name })}</h1>
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
            <Link key={x.app} href={`/${x.app}`} className="card tile" data-testid="tile">
              <svg width={28} height={28} aria-hidden="true">
                <use href={`/brand/icons.svg#shiply-${ICONS[x.app]}`} />
              </svg>
              <span>{t(`apps.${x.app}`)}</span>
              {x.count > 0 && <em className="badge">{x.count}</em>}
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}

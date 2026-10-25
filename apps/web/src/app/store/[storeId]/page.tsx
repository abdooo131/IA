import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { StoreSummary } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function StoreHomePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const [summary, t, locale] = await Promise.all([
    apiGet<StoreSummary>(`/stores/${storeId}/summary`),
    getTranslations('store.home'),
    getLocale(),
  ]);
  const tiles = [
    {
      href: 'receive',
      title: t('receive'),
      hint: t('receiveHint', { count: summary.openManifests }),
      badge: summary.openManifests,
    },
    {
      href: 'put-away',
      title: t('putAway'),
      hint: t('putAwayHint', { count: summary.unitsToPutAway }),
      badge: summary.unitsToPutAway,
    },
    { href: 'count', title: t('count'), hint: t('countHint') },
    { href: 'damaged', title: t('damaged'), hint: t('damagedHint') },
    { href: 'labels', title: t('labels'), hint: t('labelsHint') },
  ];
  return (
    <>
      <h1 className="text-h2">{localized(summary.store, locale)}</h1>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <Link
              href={`/store/${storeId}/${tile.href}`}
              className="flex min-h-[88px] items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm active:bg-surface-raised"
            >
              <span>
                <span className="block text-h3">{tile.title}</span>
                <span className="block text-body-sm text-text-muted">{tile.hint}</span>
              </span>
              {!!tile.badge && (
                <span className="ltr-iso rounded-pill bg-selected-bg px-3 py-1 text-body-sm font-bold text-link">
                  {tile.badge}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

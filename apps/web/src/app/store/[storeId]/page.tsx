import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { StoreSummary } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function StoreHomePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const [summary, t, tc, locale] = await Promise.all([
    apiGet<StoreSummary>(`/stores/${storeId}/summary`),
    getTranslations('store.home'),
    getTranslations('storeCash'),
    getLocale(),
  ]);
  const tiles: {
    href: string;
    title: string;
    hint: string;
    icon: IconName;
    badge?: number;
    alert?: boolean;
  }[] = [
    {
      href: 'orders',
      title: t('orders'),
      hint: t('ordersHint', { active: summary.activeOrders, late: summary.lateOrders }),
      icon: 'orders',
      badge: summary.activeOrders,
      alert: summary.lateOrders > 0,
    },
    {
      href: 'receive',
      icon: 'pickups',
      title: t('receive'),
      hint: t('receiveHint', { count: summary.openManifests }),
      badge: summary.openManifests,
    },
    {
      href: 'put-away',
      icon: 'inventory',
      title: t('putAway'),
      hint: t('putAwayHint', { count: summary.unitsToPutAway }),
      badge: summary.unitsToPutAway,
    },
    { href: 'count', title: t('count'), hint: t('countHint'), icon: 'scan' },
    { href: 'damaged', title: t('damaged'), hint: t('damagedHint'), icon: 'alert' },
    { href: 'labels', title: t('labels'), hint: t('labelsHint'), icon: 'print' },
    { href: 'cash', title: tc('tile'), hint: tc('tileHint'), icon: 'cash' },
  ];
  return (
    <>
      <h1 className="text-h2">{localized(summary.store, locale)}</h1>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <Link
              href={`/store/${storeId}/${tile.href}`}
              className={`flex min-h-[88px] items-center gap-3 rounded-lg border bg-surface p-4 active:bg-surface-raised ${
                tile.alert ? 'border-status-needs-action' : 'border-line'
              }`}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-selected-bg text-link">
                <Icon name={tile.icon} size={28} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-h3">{tile.title}</span>
                <span className="block text-body-sm text-text-muted">{tile.hint}</span>
              </span>
              {!!tile.badge && (
                <span
                  className={`ltr-iso rounded-pill px-3 py-1 text-body-sm font-bold ${
                    tile.alert ? 'bg-status-needs-action text-white' : 'bg-selected-bg text-link'
                  }`}
                >
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

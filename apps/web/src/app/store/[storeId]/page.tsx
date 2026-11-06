import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { ClockCard } from '@/components/hr/ClockCard';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { StoreRiderCashRow } from '@/lib/cash-control-types';
import { formatCairoTime, formatEgp } from '@/lib/format';
import type { StoreSummary } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function StoreHomePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const [summary, cash, t, tc, tr, locale] = await Promise.all([
    apiGet<StoreSummary>(`/stores/${storeId}/summary`),
    apiGet<{ maxHours: number; riders: StoreRiderCashRow[] }>(`/stores/${storeId}/cash`),
    getTranslations('store.home'),
    getTranslations('storeCash'),
    getTranslations('cashControl.storeHome'),
    getLocale(),
  ]);
  const holding = cash.riders.filter((r) => r.cashPiastres > 0);
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
    {
      href: 'transfers',
      icon: 'route',
      title: t('transfers'),
      hint: t('transfersHint', {
        pick: summary.transfersToPick,
        receive: summary.transfersToReceive,
      }),
      badge: summary.transfersToPick + summary.transfersToReceive,
    },
    {
      href: 'returns',
      icon: 'returns',
      title: t('returns'),
      hint: t('returnsHint', { count: summary.openReturns }),
      badge: summary.openReturns,
    },
    { href: 'count', title: t('count'), hint: t('countHint'), icon: 'scan' },
    { href: 'damaged', title: t('damaged'), hint: t('damagedHint'), icon: 'alert' },
    { href: 'labels', title: t('labels'), hint: t('labelsHint'), icon: 'print' },
    {
      href: 'cash',
      title: tc('tile'),
      hint: tc('tileHint'),
      icon: 'cash',
      badge: holding.length,
      alert: holding.some((r) => r.overdue),
    },
    { href: 'petty-cash', title: tr('pettyTile'), hint: tr('pettyHint'), icon: 'wallet' },
  ];
  // A sorting facility takes no customer orders and holds no rider cash.
  const shown =
    summary.store.kind === 'hub'
      ? tiles.filter((tile) => !['orders', 'cash', 'petty-cash'].includes(tile.href))
      : tiles;
  return (
    <>
      <h1 className="text-h2">{localized(summary.store, locale)}</h1>
      <div className="mt-4">
        <ClockCard compact />
      </div>
      {summary.store.kind !== 'hub' && holding.length > 0 && (
        <section className="mt-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-h3">{tr('holdingTitle')}</h2>
            <Link href={`/store/${storeId}/cash`} className="text-body-sm font-bold text-link">
              {tr('collect')}
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {holding.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-body-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{r.name}</span>{' '}
                  <span className="ltr-iso text-text-muted">{r.badgeCode}</span>
                  {r.heldSince && (
                    <span
                      className={`block text-caption ${r.overdue ? 'font-bold text-status-needs-action' : 'text-text-muted'}`}
                    >
                      {r.overdue
                        ? tr('overdue', { hours: cash.maxHours })
                        : tr('since', { time: formatCairoTime(r.heldSince, locale) })}
                    </span>
                  )}
                </span>
                <span className="ltr-iso shrink-0 font-bold">{formatEgp(r.cashPiastres)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shown.map((tile) => (
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

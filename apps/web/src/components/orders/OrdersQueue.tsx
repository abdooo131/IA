'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGetClient } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import type { OrderSummary } from '@/lib/order-types';
import { OrderStatusChip } from './OrderStatusChip';
import { StageTimer } from './StageTimer';

/** The store's work queue, most urgent first, refreshed every 15 seconds. */
export function OrdersQueue({
  storeId,
  view,
  initial,
}: {
  storeId: string;
  view: 'active' | 'done';
  initial: OrderSummary[];
}) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const [orders, setOrders] = useState(initial);

  useEffect(() => {
    const refresh = async () => {
      const fresh = await apiGetClient<OrderSummary[]>(`/stores/${storeId}/orders?view=${view}`);
      if (fresh.ok) setOrders(fresh.data);
    };
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [storeId, view]);

  const tab = (active: boolean) =>
    `rounded-pill border px-3 py-1.5 text-body-sm font-bold ${active ? 'border-transparent bg-selected-bg text-link' : 'border-line bg-surface text-text'}`;

  return (
    <div className="mt-2 space-y-4">
      <div className="flex gap-2">
        <Link href={`/store/${storeId}/orders`} className={tab(view === 'active')}>
          {t('active')}
        </Link>
        <Link href={`/store/${storeId}/orders?view=done`} className={tab(view === 'done')}>
          {t('done')}
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="text-body text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/store/${storeId}/orders/${o.id}`}
                className={`block rounded-lg border bg-surface p-4 shadow-sm active:bg-surface-raised ${o.stage?.late ? 'border-status-needs-action' : 'border-line'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ltr-iso text-h3">{o.number}</span>
                  <OrderStatusChip status={o.status} late={o.stage?.late} />
                </div>
                <p className="mt-1 text-body-sm">
                  {o.customerName} · {t('units', { count: o.units })} · {o.merchant.name}
                </p>
                {o.stage && view === 'active' && (
                  <p className="mt-1">
                    <StageTimer stage={o.stage.stage} dueAt={o.stage.dueAt} />
                  </p>
                )}
                {o.status === 'new' && o.slaStartsAt && (
                  <p className="mt-1 text-caption text-text-muted">
                    {t('queued')} ·{' '}
                    <span className="ltr-iso">{formatCairoDateTime(o.slaStartsAt, locale)}</span>
                  </p>
                )}
                {o.phoneFlagged && (
                  <p className="mt-1 text-caption text-status-needs-action">⚠ {t('phone')}</p>
                )}
                {view === 'done' && o.deliveredAt && (
                  <p className="text-caption text-text-muted">
                    <span className="ltr-iso">
                      {new Date(o.deliveredAt).toLocaleTimeString(
                        locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
                        { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' },
                      )}
                    </span>
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

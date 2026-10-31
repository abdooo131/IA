'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import type { OrderSummary } from '@/lib/order-types';
import { OrderStatusChip } from './OrderStatusChip';
import { StageTimer } from './StageTimer';

/** Order list for the merchant and admin areas. Each row links to `${hrefBase}/${id}`. */
export function OrdersTable({
  orders,
  hrefBase,
  showMerchant = false,
}: {
  orders: OrderSummary[];
  hrefBase: string;
  showMerchant?: boolean;
}) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  if (orders.length === 0) return <p className="mt-6 text-body text-text-muted">{t('empty')}</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
      <table className="w-full min-w-[820px] text-body-sm">
        <thead className="border-b border-line bg-surface-raised">
          <tr>
            <th className={th}>{t('number')}</th>
            <th className={th}>{t('customer')}</th>
            {showMerchant && <th className={th}>{t('merchant')}</th>}
            <th className={th}>{t('store')}</th>
            <th className={th}>{t('placed')}</th>
            <th className={`${th} text-end`}>{t('codAmount')}</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-line align-top last:border-0">
              <td className="px-3 py-2">
                <Link href={`${hrefBase}/${o.id}`} className="ltr-iso font-bold text-link">
                  {o.number}
                </Link>
                <p className="text-caption text-text-muted">{t('units', { count: o.units })}</p>
              </td>
              <td className="px-3 py-2">
                {o.customerName}
                <p className="ltr-iso text-caption text-text-muted">
                  {o.phoneFlagged && '⚠ '}
                  {o.customerPhone}
                </p>
              </td>
              {showMerchant && <td className="px-3 py-2">{o.merchant.name}</td>}
              <td className="px-3 py-2">{localized(o.darkStore, locale)}</td>
              <td className="ltr-iso px-3 py-2">{formatCairoDateTime(o.placedAt, locale)}</td>
              <td className="ltr-iso px-3 py-2 text-end">
                {o.paymentMethod === 'cod' ? formatEgp(o.codAmountPiastres) : t('prepaid')}
              </td>
              <td className="space-y-1 px-3 py-2">
                <OrderStatusChip status={o.status} late={o.stage?.late} />
                {o.stage && (
                  <p>
                    <StageTimer stage={o.stage.stage} dueAt={o.stage.dueAt} />
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

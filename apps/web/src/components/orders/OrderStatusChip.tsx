'use client';

import { useTranslations } from 'next-intl';
import type { OrderStatus } from '@/lib/order-types';
import { Icon } from './Icon';

/** UI spec rule: every status shows its colour, its icon and its label together. */
const LOOK: Record<OrderStatus, { color: string; icon: string }> = {
  new: { color: 'text-status-new', icon: 'new' },
  accepted: { color: 'text-status-in-progress', icon: 'orders' },
  picking: { color: 'text-status-in-progress', icon: 'packaging' },
  packed: { color: 'text-status-in-progress', icon: 'packaging' },
  out_for_delivery: { color: 'text-status-heading-to-customer', icon: 'courier' },
  delivered: { color: 'text-status-delivered', icon: 'delivered' },
  failed: { color: 'text-status-returning', icon: 'returns' },
  cancelled: { color: 'text-status-new', icon: 'alert' },
  moved_to_standard: { color: 'text-status-needs-action', icon: 'route' },
};

export function OrderStatusChip({ status, late }: { status: OrderStatus; late?: boolean }) {
  const t = useTranslations('orders');
  const look = LOOK[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-2.5 py-1 text-caption font-bold ${look.color}`}>
        <Icon name={look.icon} />
        <span className="text-text">{t(`statuses.${status}`)}</span>
      </span>
      {late && (
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-2.5 py-1 text-caption font-bold text-status-needs-action">
          <Icon name="alert" />
          <span className="text-text">{t('late')}</span>
        </span>
      )}
    </span>
  );
}

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
  attempt_failed: { color: 'text-status-needs-action', icon: 'returns' },
  delivered: { color: 'text-status-delivered', icon: 'delivered' },
  failed: { color: 'text-status-returning', icon: 'returns' },
  cancelled: { color: 'text-status-new', icon: 'alert' },
  moved_to_standard: { color: 'text-status-needs-action', icon: 'route' },
};

/** The chip background is the status color at 14%, as the handoff specifies. */
export const TINT = 'bg-[color-mix(in_srgb,currentColor_14%,transparent)]';

export function OrderStatusChip({ status, late }: { status: OrderStatus; late?: boolean }) {
  const t = useTranslations('orders');
  const look = LOOK[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-bold ${TINT} ${look.color}`}
      >
        <Icon name={look.icon} />
        <span className="text-text">{t(`statuses.${status}`)}</span>
      </span>
      {late && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-bold ${TINT} text-status-needs-action`}
        >
          <Icon name="alert" />
          <span className="text-text">{t('late')}</span>
        </span>
      )}
    </span>
  );
}

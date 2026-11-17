'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '../orders/Icon';
import { TINT } from '../orders/OrderStatusChip';

type ShipmentStatus = 'expected' | 'receiving' | 'received' | 'cancelled';

/** Shipment statuses follow the order chip rule: color, icon and label together. */
const LOOK: Record<ShipmentStatus, { color: string; icon: string }> = {
  expected: { color: 'text-status-new', icon: 'pickups' },
  receiving: { color: 'text-status-in-progress', icon: 'scan' },
  received: { color: 'text-status-delivered', icon: 'delivered' },
  cancelled: { color: 'text-status-returning', icon: 'alert' },
};

export function ShipmentStatusChip({ status }: { status: ShipmentStatus }) {
  const t = useTranslations('merchant.shipments');
  const look = LOOK[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-bold ${TINT} ${look.color}`}
    >
      <Icon name={look.icon} />
      <span className="text-text">{t(`statuses.${status}`)}</span>
    </span>
  );
}

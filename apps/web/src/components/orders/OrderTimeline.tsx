'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatCairoDateTime } from '@/lib/format';
import type { OrderDetail } from '@/lib/order-types';

function detailOf(type: string, data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  if (type === 'item_picked') return `${data.sku} × ${data.quantity} · ${data.bin}`;
  if (type === 'item_missing') return `${data.sku} × ${data.quantity}`;
  if (type === 'handed_to_rider') return `${data.rider} (${data.badge})`;
  if (type === 'items_cancelled' && Array.isArray(data.lines)) {
    return (data.lines as { sku: string; quantity: number }[]).map((l) => `${l.sku} × ${l.quantity}`).join(', ');
  }
  if (type === 'delivery_failed' || type === 'cancelled') return String(data.reason ?? '');
  if (type === 'returned_to_store') return `${data.units} → ${data.bin}`;
  return null;
}

export function OrderTimeline({ events }: { events: OrderDetail['events'] }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  return (
    <ol className="space-y-3 border-s-2 border-line ps-4">
      {events.map((e, i) => {
        const detail = detailOf(e.type, e.data);
        return (
          <li key={i} className="relative">
            <span aria-hidden className={`absolute -start-[23px] top-1.5 h-3 w-3 rounded-full ${e.type === 'late' ? 'bg-status-needs-action' : 'bg-primary'}`} />
            <p className="text-body-sm font-bold">{t.has(`events.${e.type}`) ? t(`events.${e.type}`) : e.type}</p>
            {detail && <p className="ltr-iso text-caption">{detail}</p>}
            <p className="text-caption text-text-muted">
              <span className="ltr-iso">{formatCairoDateTime(e.at, locale)}</span>
              {e.by && <> · {e.by}</>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

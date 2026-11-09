'use client';

import { useTranslations } from 'next-intl';
import { formatEgp } from '@/lib/format';
import type { ListRow } from '@/lib/list-view';

/** An alert as one sentence in the reader's language, from its type, stage and data. */
export function useAlertText() {
  const t = useTranslations('admin.alerts');
  const stages = useTranslations('orders.stages');
  const reasons = useTranslations('rider.reasons');
  return (a: { type: string; stage: string | null; data: Record<string, unknown> | null }) => {
    const d = a.data ?? {};
    switch (a.type) {
      case 'late':
        return t('types.late', {
          stage: a.stage && stages.has(a.stage) ? stages(a.stage) : String(a.stage),
        });
      case 'item_missing':
        return t('types.item_missing', {
          sku: String(d.sku ?? ''),
          quantity: String(d.quantity ?? ''),
        });
      case 'cod_mismatch':
        return t('types.cod_mismatch', {
          expected: formatEgp(Number(d.expected ?? 0)),
          collected: formatEgp(Number(d.collected ?? 0)),
        });
      case 'delivery_failed': {
        const r = String(d.reason ?? '');
        return t('types.delivery_failed', { reason: reasons.has(r) ? reasons(r) : r });
      }
      default:
        return t.has(`types.${a.type}`)
          ? t(
              `types.${a.type}`,
              Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v ?? '')])),
            )
          : a.type;
    }
  };
}

/**
 * Named cell formatters of the list view (a column's `format`): a sentence built from the
 * whole row, the same on screen and in exports.
 */
export function useListFormatters(): Record<string, (row: ListRow) => string> {
  const alertText = useAlertText();
  return {
    alert: (row) =>
      alertText({
        type: String(row.type ?? ''),
        stage: (row.stage as string | null) ?? null,
        data: (row.data as Record<string, unknown> | null) ?? null,
      }),
  };
}

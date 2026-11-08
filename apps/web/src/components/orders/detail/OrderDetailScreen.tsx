'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { StatusBar } from '@/components/workflow/StatusBar';
import { apiSend } from '@/lib/api-client';
import { OrderTabs } from '../page/OrderLayout';
import { DetailsTab } from './DetailsTab';
import { type MenuAction, OrderHeader } from './OrderHeader';
import { TrackingTab } from './TrackingTab';
import type { OrderScreenProps } from './types';

const CANCEL_REASONS = ['customer_request', 'out_of_stock', 'duplicate', 'other'] as const;

/**
 * The order page for admin and merchants: header with actions, then two tabs (details and
 * tracking). The tab lives in the address (?tab=tracking) so a link opens the same view.
 */
export function OrderDetailScreen({
  history,
  ...props
}: OrderScreenProps & { history?: ReactNode }) {
  const { order, viewer, apiPath, tab, created } = props;
  const t = useTranslations('orderDetail');
  const to = useTranslations('orders');
  const tm = useTranslations('merchant.orders');
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<(typeof CANCEL_REASONS)[number]>('customer_request');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onAction(action: MenuAction) {
    if (action === 'cancel') return setCancelling(true);
    if (tab !== 'details') router.push(`?tab=details#decision`);
    else document.getElementById('decision')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function cancel() {
    setBusy(true);
    const result = await apiSend(
      'POST',
      `${apiPath}/cancel`,
      viewer === 'admin' ? { reason } : undefined,
    );
    setBusy(false);
    if (!result.ok) {
      const known = ['too_late_to_cancel', 'invalid_order_state', 'network', 'no_access'];
      return setError(to(`errors.${known.includes(result.error) ? result.error : 'generic'}`));
    }
    setCancelling(false);
    router.refresh();
  }

  const cancelledLines = order.items.filter((i) => i.cancelledQty > 0);
  return (
    <div className="mt-3 space-y-5">
      {created && (
        <p role="status" className="rounded-lg bg-selected-bg px-4 py-3 text-body-sm">
          {order.status === 'moved_to_standard'
            ? tm('createdStandard', { number: order.number })
            : cancelledLines.length > 0
              ? tm('createdPartial', {
                  number: order.number,
                  lines: cancelledLines.map((l) => `${l.sku} × ${l.cancelledQty}`).join(', '),
                })
              : tm('created', { number: order.number })}
        </p>
      )}
      <OrderHeader props={props} onAction={onAction} />
      <StatusBar flow="order" status={order.status} />

      {cancelling && (
        <section
          className="max-w-md space-y-2 rounded-xl border border-danger bg-surface p-4"
          aria-label={to('actions.cancel')}
        >
          <h2 className="text-h3">{t('cancelTitle')}</h2>
          {viewer === 'admin' && (
            <>
              <label className="block text-body-sm font-bold" htmlFor="cancel-reason">
                {to('actions.cancelReason')}
              </label>
              <select
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm"
              >
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {to(`actions.cancelReasons.${r}`)}
                  </option>
                ))}
              </select>
            </>
          )}
          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancel()}
              className="btn border border-danger text-danger"
            >
              {to('actions.confirmCancel')}
            </button>
            <button type="button" onClick={() => setCancelling(false)} className="btn-secondary">
              {to('actions.no')}
            </button>
          </div>
        </section>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-selected-bg px-4 py-3 text-body-sm">
          {notice}
        </p>
      )}

      <OrderTabs
        tabs={(['details', 'tracking'] as const).map((value) => ({
          href: value === 'details' ? '?' : '?tab=tracking',
          label: t(`tabs.${value}`),
          active: tab === value,
        }))}
      />

      {tab === 'details' ? (
        <DetailsTab props={props} onNotice={setNotice} />
      ) : (
        <>
          <TrackingTab props={props} />
          {history}
        </>
      )}
    </div>
  );
}

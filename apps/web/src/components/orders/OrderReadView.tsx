'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import type { OrderDetail } from '@/lib/order-types';
import { title } from '@/lib/store-types';
import { FailedAttemptPanel } from './FailedAttemptPanel';
import { OrderStatusChip } from './OrderStatusChip';
import { OrderTimeline } from './OrderTimeline';
import { StageTimer } from './StageTimer';

const CANCEL_REASONS = ['customer_request', 'out_of_stock', 'duplicate', 'other'] as const;

/**
 * Read only order page for merchants and admin, with an optional cancel action and, after a
 * failed delivery attempt, the decision to try again, ship normally or cancel.
 */
export function OrderReadView({
  order,
  cancelPath,
  cancellable,
  decisionPath,
  created,
}: {
  order: OrderDetail;
  cancelPath?: string;
  cancellable: boolean;
  decisionPath?: string;
  created?: boolean;
}) {
  const t = useTranslations('orders');
  const tm = useTranslations('merchant.orders');
  const tReasons = useTranslations('rider.reasons');
  const locale = useLocale();
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<(typeof CANCEL_REASONS)[number]>('customer_request');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!cancelPath) return;
    setBusy(true);
    const result = await apiSend('POST', cancelPath, { reason });
    setBusy(false);
    if (!result.ok) {
      const known = ['too_late_to_cancel', 'invalid_order_state', 'network'];
      return setError(t(`errors.${known.includes(result.error) ? result.error : 'generic'}`));
    }
    setCancelling(false);
    router.refresh();
  }

  const cancelledLines = order.items.filter((i) => i.cancelledQty > 0);
  const photos = [
    order.packPhotoId && { id: order.packPhotoId, label: t('packPhoto') },
    ...order.deliveries.map(
      (d) => d.proofPhotoId && { id: d.proofPhotoId, label: t('proofPhoto') },
    ),
    ...order.deliveries.map(
      (d) => d.failedPhotoId && { id: d.failedPhotoId, label: t('failedAttempt.doorPhoto') },
    ),
  ].filter(Boolean) as { id: string; label: string }[];
  const cell = 'px-3 py-2';

  return (
    <div className="mt-2 space-y-6">
      {created && (
        <p
          role="status"
          className="rounded-md border border-line bg-surface-raised px-3 py-2 text-body-sm"
        >
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

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ltr-iso text-h2">{order.number}</h1>
          <p className="text-body-sm text-text-muted">
            {order.merchant.name} · {localized(order.darkStore, locale)}
            {order.zone && <> · {localized(order.zone, locale)}</>}
          </p>
          <p className="text-caption text-text-muted">
            {t('placed')}{' '}
            <span className="ltr-iso">{formatCairoDateTime(order.placedAt, locale)}</span>
            {order.createdBy && <> · {order.createdBy}</>}
          </p>
        </div>
        <div className="space-y-1 text-end">
          <OrderStatusChip status={order.status} late={order.stage?.late} />
          {order.stage && (
            <p>
              <StageTimer stage={order.stage.stage} dueAt={order.stage.dueAt} />
            </p>
          )}
          {order.slaDueAt && (
            <p className="text-caption text-text-muted">
              {t('promise', { time: '' })}
              <span className="ltr-iso">{formatCairoDateTime(order.slaDueAt, locale)}</span>
            </p>
          )}
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('customer')}</h2>
          <p className="text-body-sm">{order.customerName}</p>
          <p className="ltr-iso text-body-sm">{order.customerPhone}</p>
          {order.phoneFlagged && (
            <p className="text-caption text-status-needs-action">⚠ {t('phoneFlagged')}</p>
          )}
          <p className="text-body-sm text-text-muted">{order.addressText}</p>
          {order.customerNote && (
            <p className="text-body-sm">
              {t('note')}: {order.customerNote}
            </p>
          )}
          {order.deliveryOtp && (
            <p className="text-body-sm">
              {t('otp')}: <span className="ltr-iso font-bold">{order.deliveryOtp}</span>
            </p>
          )}
          {order.trackingToken && (
            <p className="text-body-sm">
              <a
                href={`/t/${order.trackingToken}`}
                target="_blank"
                rel="noreferrer"
                className="text-link underline"
              >
                {t('trackingLink')}
              </a>
            </p>
          )}
        </div>
        <div className="space-y-1 rounded-lg border border-line bg-surface p-4 text-body-sm">
          <h2 className="text-h3">{t('payment')}</h2>
          <p>{order.paymentMethod === 'cod' ? t('cod') : t('prepaid')}</p>
          <p className="flex justify-between">
            <span>{t('subtotal')}</span>
            <span className="ltr-iso">{formatEgp(order.subtotalPiastres)}</span>
          </p>
          <p className="flex justify-between">
            <span>{t('deliveryFee')}</span>
            <span className="ltr-iso">{formatEgp(order.deliveryFeePiastres)}</span>
          </p>
          <p className="flex justify-between font-bold">
            <span>{t('codAmount')}</span>
            <span className="ltr-iso">EGP {formatEgp(order.codAmountPiastres)}</span>
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-h3">{t('items')}</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[560px] text-body-sm">
            <thead className="border-b border-line bg-surface-raised text-label uppercase text-text-muted">
              <tr>
                <th className={`${cell} text-start`}>{t('items')}</th>
                <th className={`${cell} text-end`}>{t('ordered')}</th>
                <th className={`${cell} text-end`}>{t('picked')}</th>
                <th className={`${cell} text-end`}>{t('cancelledQty')}</th>
                <th className={`${cell} text-end`}>EGP</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.skuId} className="border-b border-line last:border-0">
                  <td className={cell}>
                    <span className="ltr-iso font-bold">{i.sku}</span> {title(i, locale)}
                  </td>
                  <td className={`ltr-iso ${cell} text-end`}>{i.quantity}</td>
                  <td className={`ltr-iso ${cell} text-end`}>{i.pickedQty}</td>
                  <td className={`ltr-iso ${cell} text-end ${i.cancelledQty ? 'text-danger' : ''}`}>
                    {i.cancelledQty}
                  </td>
                  <td className={`ltr-iso ${cell} text-end`}>
                    {formatEgp(i.unitPricePiastres * (i.quantity - i.cancelledQty))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {order.deliveries.length > 0 && (
        <section>
          <h2 className="mb-2 text-h3">{t('rider')}</h2>
          <ul className="space-y-2">
            {order.deliveries.map((d) => (
              <li key={d.id} className="rounded-lg border border-line bg-surface p-3 text-body-sm">
                <p className="font-bold">
                  {d.rider} (<span className="ltr-iso">{d.badge}</span>) ·{' '}
                  {t.has(`deliveryStatuses.${d.status}`)
                    ? t(`deliveryStatuses.${d.status}`)
                    : d.status}
                </p>
                {d.failedReason && (
                  <p className="text-danger">
                    {tReasons.has(d.failedReason) ? tReasons(d.failedReason) : d.failedReason}
                  </p>
                )}
                {d.codCollectedPiastres !== null && (
                  <p>
                    {t('codAmount')}:{' '}
                    <span className="ltr-iso">{formatEgp(d.codCollectedPiastres)}</span> /{' '}
                    <span className="ltr-iso">{formatEgp(d.codExpectedPiastres)}</span>
                  </p>
                )}
                {d.otpVerified && <p className="text-caption text-text-muted">✓ {t('otp')}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {photos.length > 0 && (
        <section className="flex flex-wrap gap-4">
          {photos.map((p) => (
            <figure key={p.id} className="space-y-1">
              <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer">
                <img
                  src={`/api/photos/${p.id}`}
                  alt={p.label}
                  className="h-40 rounded-md border border-line object-cover"
                />
              </a>
              <figcaption className="text-caption text-text-muted">{p.label}</figcaption>
            </figure>
          ))}
        </section>
      )}

      {notice && (
        <p
          role="status"
          className="rounded-md border border-line bg-surface-raised px-3 py-2 text-body-sm"
        >
          {notice}
        </p>
      )}
      {decisionPath && (
        <FailedAttemptPanel
          order={order}
          decisionPath={decisionPath}
          onDone={(text) => {
            setNotice(text);
            router.refresh();
          }}
        />
      )}

      {cancellable && cancelPath && (
        <section>
          {cancelling ? (
            <div className="max-w-md space-y-2 rounded-lg border border-danger p-3">
              <label className="block text-body-sm font-bold" htmlFor="cancel-reason">
                {t('actions.cancelReason')}
              </label>
              <select
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm"
              >
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`actions.cancelReasons.${r}`)}
                  </option>
                ))}
              </select>
              {error && <p className="text-body-sm text-danger">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cancel()}
                  className="h-10 rounded-md border border-danger px-3 text-body-sm font-bold text-danger"
                >
                  {t('actions.confirmCancel')}
                </button>
                <button
                  type="button"
                  onClick={() => setCancelling(false)}
                  className="h-10 rounded-md border border-line px-3 text-body-sm"
                >
                  {t('actions.no')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCancelling(true)}
              className="h-10 rounded-md border border-line px-4 text-body-sm font-bold text-danger"
            >
              {t('actions.cancel')}
            </button>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-h3">{t('timeline')}</h2>
        <OrderTimeline events={order.events} />
      </section>
    </div>
  );
}

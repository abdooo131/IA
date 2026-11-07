'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import type { OrderDetail } from '@/lib/order-types';

type Action = 'retry' | 'ship_normally' | 'cancel';

const KNOWN = ['goods_not_back', 'invalid_order_state', 'network'];
const button =
  'h-11 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

/**
 * A failed delivery attempt waiting for a decision: what happened, whether the goods are
 * back, and the choice to try again, ship it normally or cancel. Used by store staff,
 * merchants and admin, each posting to their own decision address.
 */
export function FailedAttemptPanel({
  order,
  decisionPath,
  onDone,
}: {
  order: OrderDetail;
  decisionPath: string;
  onDone(message: string): void | Promise<void>;
}) {
  const t = useTranslations('orders.failedAttempt');
  const tOrders = useTranslations('orders');
  const tReasons = useTranslations('rider.reasons');
  const locale = useLocale();
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const failed = order.deliveries.filter((d) => d.status === 'failed');
  const last = failed[0];
  if (order.status !== 'attempt_failed' || !last) return null;
  const code = (last.failedReason ?? '').split(':')[0]!;
  const reason = tReasons.has(code) ? tReasons(code) : (last.failedReason ?? '');

  async function decide(action: Action) {
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', decisionPath, {
      action,
      ...(action !== 'retry' && note.trim() ? { reason: note.trim() } : {}),
    });
    setBusy(false);
    if (!result.ok)
      return setError(tOrders(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setConfirming(null);
    await onDone(t(action === 'retry' ? 'retried' : 'closed'));
  }

  return (
    <section className="space-y-3 rounded-lg border border-status-needs-action bg-surface p-4">
      <h2 className="text-h3">{t('title', { attempt: failed.length })}</h2>
      <p className="text-body-sm">
        <span className="font-bold">{t('reason')}:</span> {reason}
      </p>
      <p className="text-caption text-text-muted">{t('calls', { count: last.callAttempts })}</p>
      {last.failedPhotoId && (
        <a
          href={`/api/photos/${last.failedPhotoId}`}
          target="_blank"
          rel="noreferrer"
          className="text-body-sm text-link underline"
        >
          {t('doorPhoto')}
        </a>
      )}
      <p className={`text-body-sm ${order.goodsBack ? '' : 'text-status-needs-action'}`}>
        {order.goodsBack ? t('goodsBack') : t('goodsOnWay')}
      </p>
      {order.retryHoldUntil && (
        <p className="text-caption text-text-muted">
          {t('deadline', { time: formatCairoDateTime(order.retryHoldUntil, locale) })}
        </p>
      )}

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="space-y-2">
          {confirming !== 'retry' && (
            <label className="block text-body-sm">
              {t('note')}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                className="mt-1 block h-11 w-full rounded-md border border-line bg-surface px-3"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={`${button} ${confirming === 'retry' ? '' : 'text-danger'}`}
              onClick={() => void decide(confirming)}
            >
              {t('confirm')}: {t(confirming === 'ship_normally' ? 'shipNormally' : confirming)}
            </button>
            <button type="button" className={button} onClick={() => setConfirming(null)}>
              {t('back')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${button} border-primary text-link`}
              disabled={!order.goodsBack}
              onClick={() => setConfirming('retry')}
            >
              {t('retry')}
            </button>
            <button type="button" className={button} onClick={() => setConfirming('ship_normally')}>
              {t('shipNormally')}
            </button>
            <button
              type="button"
              className={`${button} text-danger`}
              onClick={() => setConfirming('cancel')}
            >
              {t('cancel')}
            </button>
          </div>
          {!order.goodsBack && (
            <p className="text-caption text-text-muted">{t('retryNeedsGoods')}</p>
          )}
        </div>
      )}
    </section>
  );
}

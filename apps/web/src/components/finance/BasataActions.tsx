'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { BasataDepositDetail } from '@/lib/basata';
import { formatEgp } from '@/lib/format';

/**
 * Accounting's actions on a Basata deposit waiting for review: approve it once the receipt
 * matches the amount and reference, or reject it with a reason (at least 5 characters). The
 * rider's own deposit is never theirs to decide.
 */
export function BasataActions({
  detail,
  canUse,
  meId,
}: {
  detail: BasataDepositDetail;
  canUse: boolean;
  meId: string | null;
}) {
  const t = useTranslations('basata');
  const router = useRouter();
  const d = detail.deposit;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  if (d.status !== 'pending' || !canUse) return null;
  if (meId === d.rider.userId)
    return <p className="text-body-sm text-text-muted">{t('errors.own_deposit')}</p>;

  async function send(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    const result = await apiSend('POST', path, body);
    setBusy(false);
    if (!result.ok)
      return setMessage({
        text: t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'),
        error: true,
      });
    setMessage({ text: done, error: false });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          disabled={busy}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50"
          onClick={() =>
            void send(`/finance/basata/deposits/${d.id}/approve`, undefined, t('approvedDone'))
          }
        >
          {t('approve', { amount: formatEgp(d.amountPiastres) })}
        </button>
        <button
          type="button"
          disabled={busy}
          className="inline-flex h-10 items-center rounded-md border border-danger px-4 text-body-sm font-bold text-danger disabled:opacity-50"
          onClick={() => setRejecting(!rejecting)}
        >
          {t('reject')}
        </button>
      </div>
      {rejecting && (
        <div className="max-w-lg">
          <label className="block text-caption">
            {t('rejectReason')}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 min-h-20 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-body-sm"
            />
          </label>
          <p className="text-caption text-text-muted">{t('rejectHint')}</p>
          <button
            type="button"
            disabled={busy || reason.trim().length < 5}
            className="mt-2 inline-flex h-10 items-center rounded-md border border-danger px-4 text-body-sm font-bold text-danger disabled:opacity-50"
            onClick={() =>
              void send(
                `/finance/basata/deposits/${d.id}/reject`,
                { reason: reason.trim() },
                t('rejectedDone'),
              )
            }
          >
            {t('confirmReject')}
          </button>
        </div>
      )}
      {message && (
        <p
          role="status"
          className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

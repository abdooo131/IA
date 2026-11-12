'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import type { WithdrawalView } from '@/lib/rider-wallet';
import { StatusPill } from '@/components/rider/RiderWallet';

/**
 * Rider pay: withdrawals Accounting approved for cash at this store. The store manager hands the
 * cash to the rider and records it here; it comes out of the store's cash box.
 */
export function StoreWithdrawals({ storeId, rows }: { storeId: string; rows: WithdrawalView[] }) {
  const t = useTranslations('riderPay');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});

  async function pay(w: WithdrawalView) {
    setBusy(true);
    const r = await apiSend('POST', `/stores/${storeId}/cash/withdrawals/${w.id}/pay`, {
      reference: refs[w.id]?.trim() || `${w.number} cash`,
    });
    setBusy(false);
    setMessage(
      r.ok
        ? { text: t('paidDone'), error: false }
        : {
            text: t(t.has(`errors.${r.error}`) ? `errors.${r.error}` : 'errors.generic'),
            error: true,
          },
    );
    if (r.ok) router.refresh();
  }

  return (
    <section aria-labelledby="store-withdrawals" className="mt-6 space-y-2">
      <h2 id="store-withdrawals" className="text-h3">
        {t('storeTitle')}
      </h2>
      <p className="text-body-sm text-text-muted">{t('storeIntro')}</p>
      {rows.length === 0 && <p className="text-body-sm text-text-muted">{t('noneHere')}</p>}
      <ul className="space-y-2">
        {rows.map((w) => (
          <li key={w.id} className="rounded-lg border border-line bg-surface p-3 text-body-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">
                <span className="ltr-iso">{w.number}</span> · {w.rider.name}
              </span>
              <StatusPill status={w.status} />
            </div>
            <p className="mt-1">
              {t('giveCash', { amount: formatEgp(w.amountPiastres) })}
              <span className="text-text-muted">
                {' · '}
                {formatCairoDateTime(w.approvedAt ?? w.createdAt, locale)}
              </span>
            </p>
            {w.status === 'approved' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={refs[w.id] ?? ''}
                  onChange={(e) => setRefs({ ...refs, [w.id]: e.target.value })}
                  placeholder={t('receiptNote')}
                  aria-label={t('receiptNote')}
                  className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3"
                />
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary h-10 px-4"
                  onClick={() => void pay(w)}
                >
                  {t('cashGiven')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p
          role="status"
          className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

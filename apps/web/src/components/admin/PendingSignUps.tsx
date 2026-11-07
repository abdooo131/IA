'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import type { AdminMerchant } from './MerchantsManager';

/** Merchants who applied from /signup, waiting for admin to open or refuse the account. */
export function PendingSignUps({ merchants }: { merchants: AdminMerchant[] }) {
  const t = useTranslations('admin.merchants.signups');
  const locale = useLocale();
  const router = useRouter();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function decide(id: string, approve: boolean) {
    setBusy(true);
    setError(false);
    const result = await apiSend(
      'POST',
      `/admin/merchants/${id}/${approve ? 'approve' : 'reject'}`,
      approve ? {} : { reason },
    );
    setBusy(false);
    if (!result.ok) return setError(true);
    setRejecting(null);
    setReason('');
    router.refresh();
  }

  if (merchants.length === 0) return null;
  const button = 'h-10 rounded-md px-4 text-body-sm font-bold disabled:opacity-50';
  return (
    <section className="mt-4 space-y-3 rounded-lg border border-status-needs-action bg-surface p-4">
      <h2 className="text-h3">{t('title', { count: merchants.length })}</h2>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {t('error')}
        </p>
      )}
      <ul className="space-y-3">
        {merchants.map((m) => (
          <li key={m.id} className="space-y-2 border-t border-line pt-3 first:border-0 first:pt-0">
            <p className="text-body font-bold">{m.name}</p>
            <p className="text-body-sm text-text-muted">
              <span className="ltr-iso">{m.contactEmail}</span> ·{' '}
              <span className="ltr-iso">{m.contactPhone}</span> ·{' '}
              <span className="ltr-iso">{formatCairoDateTime(m.createdAt, locale)}</span>
            </p>
            {rejecting === m.id ? (
              <div className="flex flex-wrap gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('reason')}
                  maxLength={300}
                  className="h-10 min-w-56 flex-1 rounded-md border border-line bg-surface px-3 text-body-sm"
                />
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 2}
                  onClick={() => void decide(m.id, false)}
                  className={`${button} border border-danger text-danger`}
                >
                  {t('confirmReject')}
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(null)}
                  className={`${button} border border-line`}
                >
                  {t('back')}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(m.id, true)}
                  className={`${button} bg-primary text-on-primary`}
                >
                  {t('approve')}
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(m.id)}
                  className={`${button} border border-line text-danger`}
                >
                  {t('reject')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

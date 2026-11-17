'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import type { FrozenRider } from '@/lib/basata';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

/**
 * Riders frozen for cash not handed in by the deposit deadline: what they hold, what was taken
 * from them (to their office or their dues), deposits waiting. Only Accounting (use) unfreezes,
 * with a written reason.
 */
export function FrozenRiders({ riders, canUse }: { riders: FrozenRider[]; canUse: boolean }) {
  const t = useTranslations('basata.frozen');
  const tb = useTranslations('basata');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function unfreeze(riderId: string) {
    setBusy(true);
    setMessage(null);
    const r = await apiSend('POST', `/finance/frozen-riders/${riderId}/unfreeze`, {
      reason: reason.trim(),
    });
    setBusy(false);
    if (!r.ok)
      return setMessage({
        text: tb.has(`errors.${r.error}`) ? tb(`errors.${r.error}`) : tb('errors.generic'),
        error: true,
      });
    setMessage({ text: t('done'), error: false });
    setOpen(null);
    setReason('');
    router.refresh();
  }

  // The message stays above the empty state too: unfreezing the last rider empties the list.
  return (
    <div className="mt-4 space-y-3">
      {message && (
        <p
          role="status"
          className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
      {riders.length === 0 && <p className="text-body text-text-muted">{t('none')}</p>}
      <ul className="space-y-3">
        {riders.map((r) => (
          <li key={r.riderId} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-bold">
                  {r.name} <span className="ltr-iso text-text-muted">({r.badgeCode})</span>
                </p>
                <p className="text-caption text-text-muted">
                  {localized(r.store, locale)} · {t(`reasons.${r.reason}`)} ·{' '}
                  <span className="ltr-iso">{formatCairoDateTime(r.frozenAt, locale)}</span>
                </p>
                {r.office && <p className="text-caption">{t('office', { name: r.office.name })}</p>}
              </div>
              <Link
                href={`/finance/basata?v=rider:${r.riderId}&f=`}
                className="text-body-sm font-semibold text-link"
              >
                {t('deposits')}
              </Link>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-body-sm sm:grid-cols-3">
              <div>
                <dt className="text-text-muted">{t('cash')}</dt>
                <dd className="ltr-iso font-bold">{formatEgp(r.cashPiastres)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t('deducted')}</dt>
                <dd className="ltr-iso font-bold text-danger">{formatEgp(r.deductedPiastres)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t('pending')}</dt>
                <dd className="ltr-iso font-bold">{formatEgp(r.pendingPiastres)}</dd>
              </div>
            </dl>
            {canUse &&
              (open === r.riderId ? (
                <div className="mt-3 max-w-lg">
                  <label className="block text-caption">
                    {t('reason')}
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 min-h-20 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-body-sm"
                    />
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy || reason.trim().length < 5}
                      onClick={() => void unfreeze(r.riderId)}
                      className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50"
                    >
                      {t('confirm')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(null)}
                      className="inline-flex h-10 items-center rounded-md border border-line px-4 text-body-sm"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(r.riderId);
                    setReason('');
                  }}
                  className="mt-3 inline-flex h-10 items-center rounded-md border border-primary px-4 text-body-sm font-bold text-link"
                >
                  {t('unfreeze')}
                </button>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

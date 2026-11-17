'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatEgp } from '@/lib/format';
import type { FinanceClaimPage } from '@/lib/my-pay-types';

const field = 'h-10 rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/**
 * Accounting's actions on an approved expense claim: pay it from a bank or cash box (each shown
 * with what it holds) with an optional bank reference, or refuse it with a reason.
 */
export function ClaimActions({
  page,
  canUse,
  meId,
  approverIsMe,
}: {
  page: FinanceClaimPage;
  canUse: boolean;
  meId: string | null;
  /** The reader approved it as the manager and the amount is from the approval limit */
  approverIsMe: boolean;
}) {
  const t = useTranslations('myPay');
  const locale = useLocale();
  const router = useRouter();
  const c = page.claim;
  const [account, setAccount] = useState(page.moneyAccounts[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  if (c.status !== 'pending_accounting' || !canUse) return null;
  const own = meId === c.userId;
  const chosen = page.moneyAccounts.find((a) => a.id === account);

  async function send(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    const result = await apiSend(`POST`, path, body);
    setBusy(false);
    if (!result.ok)
      return setMessage({
        text: t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'),
        error: true,
      });
    setMessage({ text: done, error: false });
    router.refresh();
  }

  if (own) return <p className="text-body-sm text-text-muted">{t('errors.own_claim')}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-caption">
          {t('payFrom')}
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className={`${field} mt-1 block`}
          >
            {page.moneyAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {locale === 'ar' ? a.nameAr : a.nameEn} ({formatEgp(a.balancePiastres)})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('reference')}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={`${field} ltr-iso mt-1 block`}
            maxLength={120}
          />
        </label>
        <button
          type="button"
          disabled={busy || !account}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50"
          onClick={() =>
            void send(
              `/finance/expense-claims/${c.id}/pay`,
              { moneyAccountId: account, ...(reference.trim() && { reference: reference.trim() }) },
              t('paidDone'),
            )
          }
        >
          {t('pay', { amount: formatEgp(c.amountPiastres) })}
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
      {chosen && chosen.balancePiastres < c.amountPiastres && (
        <p className="text-caption text-danger">{t('errors.not_enough_money')}</p>
      )}
      {approverIsMe && <p className="text-caption text-text-muted">{t('secondPersonHint')}</p>}
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
          <button
            type="button"
            disabled={busy || reason.trim().length < 3}
            className="mt-2 inline-flex h-10 items-center rounded-md border border-danger px-4 text-body-sm font-bold text-danger disabled:opacity-50"
            onClick={() =>
              void send(
                `/finance/expense-claims/${c.id}/reject`,
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

'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MethodText, StatusPill } from '@/components/rider/RiderWallet';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import type { BookAccount } from '@/lib/finance-types';
import type { WithdrawalList, WithdrawalView } from '@/lib/rider-wallet';
import { accountLabel, loadMoneyAccounts } from './BankSelect';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 min-w-0 rounded-md border border-line bg-surface px-3 text-body-sm';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const TABS = ['open', 'requested', 'approved', 'paid', 'rejected', 'cancelled', 'all'] as const;
type Tab = (typeof TABS)[number];

function matches(tab: Tab, w: WithdrawalView) {
  if (tab === 'all') return true;
  if (tab === 'open') return w.status === 'requested' || w.status === 'approved';
  return w.status === tab;
}

/**
 * Accounting's rider withdrawals (CLAUDE.md "Rider pay"): each request with the rider, store,
 * what they receive, what is deducted and where the money goes; approve, reject with a reason,
 * then pay from a bank or cash box with a reference. From the approval limit the person who
 * pays is not the one who approved.
 */
export function RiderWithdrawals({ list, canUse }: { list: WithdrawalList; canUse: boolean }) {
  const t = useTranslations('riderPay');
  const [tab, setTab] = useState<Tab>('open');
  const shown = list.withdrawals.filter((w) => matches(tab, w));
  return (
    <>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface p-3">
          <dt className="text-caption text-text-muted">{t('statuses.requested')}</dt>
          <dd className="text-h3 tabular">{list.counts.requested}</dd>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3">
          <dt className="text-caption text-text-muted">{t('toPay')}</dt>
          <dd className="text-h3 tabular">{list.counts.approved}</dd>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3">
          <dt className="text-caption text-text-muted">{t('openAmount')}</dt>
          <dd className="text-h3 tabular ltr-iso">{formatEgp(list.counts.openPiastres)}</dd>
        </div>
      </dl>
      <nav className="-mx-1 mt-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-current={tab === k ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-body-sm font-semibold ${
              tab === k
                ? 'border-primary text-link'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </nav>
      {shown.length === 0 && <p className="mt-4 text-body-sm text-text-muted">{t('noneHere')}</p>}
      <ul className="mt-4 space-y-3">
        {shown.map((w) => (
          <WithdrawalCard key={w.id} w={w} canUse={canUse} />
        ))}
      </ul>
    </>
  );
}

function WithdrawalCard({ w, canUse }: { w: WithdrawalView; canUse: boolean }) {
  const t = useTranslations('riderPay');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const router = useRouter();
  const action = useFinanceAction();
  const [mode, setMode] = useState<'none' | 'reject' | 'pay'>('none');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [account, setAccount] = useState('');
  const [accounts, setAccounts] = useState<BookAccount[]>([]);
  useEffect(() => {
    if (mode === 'pay') void loadMoneyAccounts().then(setAccounts);
  }, [mode]);

  const done = async (path: string, body: unknown, text: string) => {
    const ok = await action.send('POST', `/finance/rider-withdrawals/${w.id}/${path}`, body, () =>
      t(text),
    );
    if (ok) {
      setMode('none');
      router.refresh();
    }
  };

  return (
    <li className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">
            <span className="ltr-iso">{w.number}</span> · {w.rider.name} (
            <span className="ltr-iso">{w.rider.badgeCode}</span>)
          </p>
          <p className="text-caption text-text-muted">
            {localized(w.darkStore, locale)} · {formatCairoDateTime(w.createdAt, locale)}
          </p>
          <p className="mt-1 text-body-sm">
            <MethodText details={w.details} />
          </p>
        </div>
        <div className="text-end">
          <StatusPill status={w.status} />
          <p className="mt-1 text-h3 tabular ltr-iso">{formatEgp(w.amountPiastres)}</p>
        </div>
      </div>
      {w.deductionPiastres > 0 && (
        <p className="mt-2 text-body-sm">
          {t('deductionsLine', {
            dues: formatEgp(w.deductions.duesPiastres),
            advance: formatEgp(w.deductions.advancePiastres),
            gross: formatEgp(w.grossPiastres),
          })}
        </p>
      )}
      <p className="mt-1 text-caption text-text-muted">
        {w.approvedBy && t('approvedBy', { name: w.approvedBy.name })}
        {w.paidBy && (
          <>
            {' · '}
            {t('paidBy', {
              name: w.paidBy.name,
              from: w.paidFrom ? `${w.paidFrom.code} ${w.paidFrom.name}` : '',
            })}
            {w.reference && (
              <>
                {' · '}
                <span className="ltr-iso">{w.reference}</span>
              </>
            )}
          </>
        )}
        {w.rejectedBy && t('rejectedBy', { name: w.rejectedBy.name, reason: w.rejectReason ?? '' })}
      </p>
      {canUse && (w.status === 'requested' || w.status === 'approved') && (
        <div className="mt-3 flex flex-wrap gap-2">
          {w.status === 'requested' && (
            <button
              type="button"
              className="btn-primary h-10 px-4"
              disabled={action.busy}
              onClick={() => void done('approve', {}, 'approvedDone')}
            >
              {t('approve')}
            </button>
          )}
          {w.status === 'approved' && (
            <button
              type="button"
              className="btn-primary h-10 px-4"
              onClick={() => setMode(mode === 'pay' ? 'none' : 'pay')}
            >
              {t('pay')}
            </button>
          )}
          <button
            type="button"
            className={button}
            onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')}
          >
            {t('reject')}
          </button>
        </div>
      )}
      {mode === 'reject' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reasonLabel')}
            aria-label={t('reasonLabel')}
            className={`${field} flex-1`}
          />
          <button
            type="button"
            className={button}
            disabled={action.busy || reason.trim().length < 3}
            onClick={() => void done('reject', { reason }, 'rejectedDone')}
          >
            {tf('save')}
          </button>
        </div>
      )}
      {mode === 'pay' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            aria-label={t('payFrom')}
            className={`${field} max-w-full`}
          >
            <option value="">
              {w.method === 'store_cash' ? t('storeBoxDefault') : t('mainBankDefault')}
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a, locale)}
              </option>
            ))}
          </select>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={tf('reference')}
            aria-label={tf('reference')}
            className={`${field} flex-1`}
          />
          <button
            type="button"
            className="btn-primary h-10 px-4"
            disabled={action.busy || reference.trim().length < 2}
            onClick={() =>
              void done(
                'pay',
                { reference, ...(account && { moneyAccountId: account }) },
                'paidDone',
              )
            }
          >
            {t('markPaid')}
          </button>
        </div>
      )}
      <ActionMessage message={action.message} />
    </li>
  );
}

export { WithdrawalCard };

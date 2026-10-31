'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import type { FinanceOverview, PayoutSchedule } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { BankSelect } from './BankSelect';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const SCHEDULES: PayoutSchedule[] = ['daily', 'twice_weekly', 'weekly'];
const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

type Merchant = FinanceOverview['merchants'][number];

function MerchantCard({ merchant, today }: { merchant: Merchant; today: string }) {
  const t = useTranslations('finance.merchants');
  const tf = useTranslations('finance');
  const action = useFinanceAction();
  const [panel, setPanel] = useState<'receipt' | 'adjust' | null>(null);
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [bank, setBank] = useState('');

  const piastres = parseEgp(amount, { allowNegative: panel === 'adjust' });
  async function submit() {
    if (!piastres) return action.setMessage({ text: t('errors.invalid_amount'), error: true });
    const ok =
      panel === 'receipt'
        ? await action.send('POST', '/finance/receipts', {
            merchantId: merchant.id,
            amountPiastres: piastres,
            reference: text,
            bankAccountId: bank || undefined,
            idempotencyKey: newActionKey(),
          })
        : await action.send('POST', '/finance/adjustments', {
            merchantId: merchant.id,
            amountPiastres: piastres,
            reason: text,
            idempotencyKey: newActionKey(),
          });
    if (ok) {
      setPanel(null);
      setAmount('');
      setText('');
    }
  }

  return (
    <li className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-h3">{merchant.name}</p>
          {merchant.draftPayout && (
            <p className="text-caption text-text-muted">
              {t('openDraft', { amount: formatEgp(merchant.draftPayout.amountPiastres) })}
            </p>
          )}
        </div>
        <div className="text-end">
          <p className="text-caption text-text-muted">
            {merchant.owedPiastres < 0 ? t('owes') : t('owed')}
          </p>
          <p className="text-h3">
            <Amount piastres={Math.abs(merchant.owedPiastres)} strong /> {tf('egp')}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-caption text-text-muted" htmlFor={`schedule-${merchant.id}`}>
          {t('schedule')}
        </label>
        <select
          id={`schedule-${merchant.id}`}
          defaultValue={merchant.payoutSchedule}
          disabled={action.busy}
          onChange={(e) =>
            void action.send('PATCH', `/finance/merchants/${merchant.id}/payout-schedule`, {
              payoutSchedule: e.target.value,
            })
          }
          className={field}
        >
          {SCHEDULES.map((s) => (
            <option key={s} value={s}>
              {tf(`schedules.${s}`)}
            </option>
          ))}
        </select>
        <Link
          href={`/finance/merchants/${merchant.id}`}
          className={`${button} flex items-center text-link`}
        >
          {t('statement')}
        </Link>
        <button
          type="button"
          className={button}
          disabled={action.busy || merchant.owedPiastres <= 0 || !!merchant.draftPayout}
          onClick={() =>
            void action.send('POST', '/finance/payouts', {
              merchantId: merchant.id,
              cutoffDay: today,
            })
          }
        >
          {t('prepare')}
        </button>
        <button
          type="button"
          className={button}
          onClick={() => setPanel(panel === 'receipt' ? null : 'receipt')}
        >
          {t('receipt')}
        </button>
        <button
          type="button"
          className={button}
          onClick={() => setPanel(panel === 'adjust' ? null : 'adjust')}
        >
          {t('adjust')}
        </button>
      </div>
      {panel && (
        <div className="space-y-2 rounded-md border border-line p-3">
          {panel === 'adjust' && <p className="text-caption text-text-muted">{t('adjustHelp')}</p>}
          <div className="flex flex-wrap gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              placeholder={tf('amount')}
              aria-label={tf('amount')}
              className={`${field} w-36`}
            />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={panel === 'receipt' ? tf('reference') : t('reason')}
              aria-label={panel === 'receipt' ? tf('reference') : t('reason')}
              className={`${field} min-w-0 flex-1`}
            />
            {panel === 'receipt' && (
              <BankSelect value={bank} onChange={setBank} className={field} />
            )}
            <button
              type="button"
              className={button}
              disabled={action.busy}
              onClick={() => void submit()}
            >
              {tf('save')}
            </button>
          </div>
        </div>
      )}
      <ActionMessage message={action.message} />
    </li>
  );
}

export function MerchantWallets({ merchants, today }: { merchants: Merchant[]; today: string }) {
  return (
    <ul className="mt-4 space-y-3">
      {merchants.map((m) => (
        <MerchantCard key={m.id} merchant={m} today={today} />
      ))}
    </ul>
  );
}

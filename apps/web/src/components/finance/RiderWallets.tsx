'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import type { FinanceOverview } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { BankSelect } from './BankSelect';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

type Rider = FinanceOverview['riders'][number];
const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

function RiderRow({ rider }: { rider: Rider }) {
  const t = useTranslations('finance.riders');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const action = useFinanceAction();
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState(formatEgp(rider.bonusOwedPiastres).replace(/,/g, ''));
  const [from, setFrom] = useState<'bank' | 'store_cash'>('bank');
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const piastres = parseEgp(amount);
  return (
    <li className="space-y-2 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold">
            {rider.name} (<span className="ltr-iso">{rider.badgeCode}</span>)
          </p>
          <p className="text-caption text-text-muted">
            {localized(rider.darkStore, locale)}
            {rider.pendingHandovers > 0 && (
              <>
                {' '}
                · {t('pending')}: <span className="ltr-iso">{rider.pendingHandovers}</span>
              </>
            )}
          </p>
        </div>
        <dl className="flex gap-6 text-end">
          <div>
            <dt className="text-caption text-text-muted">{t('cash')}</dt>
            <dd className="text-h3">
              <Amount piastres={rider.cashPiastres} />
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('bonus')}</dt>
            <dd className="text-h3">
              <Amount piastres={rider.bonusOwedPiastres} />
            </dd>
          </div>
        </dl>
      </div>
      {rider.bonusOwedPiastres > 0 && (
        <button type="button" className={button} onClick={() => setPaying(!paying)}>
          {t('pay')}
        </button>
      )}
      {paying && (
        <div className="flex flex-wrap gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            aria-label={tf('amount')}
            className={`${field} w-32`}
          />
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value as typeof from)}
            className={field}
            aria-label={t('pay')}
          >
            <option value="bank">{t('fromBank')}</option>
            <option value="store_cash">{t('fromStore')}</option>
          </select>
          {from === 'bank' && <BankSelect value={bank} onChange={setBank} className={field} />}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={tf('reference')}
            aria-label={tf('reference')}
            className={`${field} min-w-0 flex-1`}
          />
          <button
            type="button"
            className={button}
            disabled={action.busy || !piastres || reference.trim().length < 2}
            onClick={async () => {
              const ok = await action.send(
                'POST',
                '/finance/rider-bonus-payouts',
                {
                  riderId: rider.id,
                  amountPiastres: piastres,
                  from,
                  bankAccountId: from === 'bank' && bank ? bank : undefined,
                  reference,
                  idempotencyKey: newActionKey(),
                },
                () => t('paid'),
              );
              if (ok) setPaying(false);
            }}
          >
            {tf('save')}
          </button>
        </div>
      )}
      <ActionMessage message={action.message} />
    </li>
  );
}

export function RiderWallets({ riders }: { riders: Rider[] }) {
  return (
    <ul className="mt-4 space-y-3">
      {riders.map((r) => (
        <RiderRow key={r.id} rider={r} />
      ))}
    </ul>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CorporateTax } from '@/lib/finance-types';
import { parseEgp } from '@/lib/money';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

/** Books the year's company income tax (the amount agreed with the accountant). */
export function CorporateTaxForm({ tax }: { tax: CorporateTax }) {
  const t = useTranslations('finance.returns');
  const action = useFinanceAction();
  const [amount, setAmount] = useState(
    ((tax.bookedPiastres || tax.estimatePiastres) / 100).toFixed(2),
  );
  const value = parseEgp(amount);
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        aria-label={t('bookAmount')}
        className="h-10 w-40 rounded-md border border-line bg-surface px-2 text-end text-body-sm"
      />
      <button
        type="button"
        disabled={action.busy || value === null}
        onClick={() =>
          void action.send('POST', '/finance/tax-returns/corporate', {
            year: tax.year,
            amountPiastres: value,
          })
        }
        className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
      >
        {t('book')}
      </button>
      <ActionMessage message={action.message} />
    </div>
  );
}

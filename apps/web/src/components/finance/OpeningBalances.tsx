'use client';

import { cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import type { BookAccount } from '@/lib/finance-types';
import { parseEgp } from '@/lib/money';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';

/**
 * The balances the books start from, typed as an accountant reads them: money held in each
 * bank and box, what we owe (merchants, VAT) and what is owed to us. Posted once; the
 * difference goes to Opening balances.
 */
export function OpeningBalances({
  accounts,
  posted,
}: {
  accounts: BookAccount[];
  posted: boolean;
}) {
  const t = useTranslations('finance.opening');
  const locale = useLocale();
  const action = useFinanceAction();
  const [day, setDay] = useState(cairoDay(new Date()));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  if (posted) return <p className="mt-4 text-body">{t('alreadyPosted')}</p>;
  const lines = Object.entries(amounts)
    .map(([accountId, text]) => ({
      accountId,
      amountPiastres: text.trim() ? parseEgp(text.replace('-', '')) : 0,
      negative: text.trim().startsWith('-'),
    }))
    .filter((l) => l.amountPiastres)
    .map((l) => ({
      accountId: l.accountId,
      amountPiastres: (l.negative ? -1 : 1) * (l.amountPiastres as number),
    }));
  const bad = Object.values(amounts).some((v) => v.trim() && parseEgp(v.replace('-', '')) === null);
  return (
    <div className="mt-4 space-y-4">
      <label className="block max-w-xs text-caption">
        {t('day')}
        <span className="mt-1 block">
          <DateInput
            value={day}
            max={cairoDay(new Date())}
            onChange={(e) => setDay(e.target.value)}
            className={field}
          />
        </span>
      </label>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-caption text-text-muted">
              <th className="px-3 py-2 text-start">{t('account')}</th>
              <th className="px-3 py-2 text-end">{t('amount')}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-3 py-2">
                  <span className="ltr-iso me-2 text-text-muted">{a.code}</span>
                  {locale === 'ar' ? a.nameAr : a.nameEn}
                </td>
                <td className="px-3 py-2 text-end">
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.00"
                    aria-label={locale === 'ar' ? a.nameAr : a.nameEn}
                    value={amounts[a.id] ?? ''}
                    onChange={(e) => setAmounts({ ...amounts, [a.id]: e.target.value })}
                    className={`${field} w-36 text-end`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-text-muted">{t('hint')}</p>
      <button
        type="button"
        disabled={action.busy || bad || lines.length === 0}
        onClick={() => void action.send('POST', '/finance/opening-balances', { day, lines })}
        className="h-11 rounded-md bg-primary px-5 font-bold text-on-primary disabled:opacity-50"
      >
        {t('post')}
      </button>
      <ActionMessage message={action.message} />
    </div>
  );
}

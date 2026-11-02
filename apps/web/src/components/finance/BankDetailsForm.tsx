'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

export interface BankDetails {
  bankName: string | null;
  bankAccountNumber: string | null;
  iban: string | null;
  beneficiaryName: string | null;
}

const FIELDS = ['beneficiaryName', 'bankName', 'bankAccountNumber', 'iban'] as const;

/** Where a merchant's payouts are sent (the merchant or finance edits it). */
export function BankDetailsForm({ details, path }: { details: BankDetails; path: string }) {
  const t = useTranslations('finance.bankDetails');
  const action = useFinanceAction();
  const [d, setD] = useState(details);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((k) => (
          <label key={k} className="block text-caption">
            {t(k)}
            <input
              value={d[k] ?? ''}
              onChange={(e) => setD({ ...d, [k]: e.target.value })}
              dir={k === 'beneficiaryName' || k === 'bankName' ? 'auto' : 'ltr'}
              placeholder={k === 'iban' ? 'EG00 0000 0000 0000 0000 0000 0000 0' : undefined}
              className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={action.busy}
        onClick={() =>
          void action.send(
            'PUT',
            path,
            Object.fromEntries(FIELDS.map((k) => [k, d[k]?.trim() ? d[k]!.trim() : null])),
          )
        }
        className="h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50"
      >
        {t('save')}
      </button>
      <ActionMessage message={action.message} />
    </div>
  );
}

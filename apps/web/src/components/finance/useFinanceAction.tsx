'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

const KNOWN = [
  'nothing_to_pay',
  'payout_already_open',
  'reason_required',
  'invalid_amount',
  'more_than_cash_in_store',
  'more_than_owed',
  'handover_not_pending',
  'payout_not_draft',
  'validation_failed',
  'account_name_taken',
  'bank_account_exists',
  'bank_details_required',
  'group_not_open',
  'group_full',
  'account_locked',
  'account_has_balance',
  'account_inactive',
  'account_not_found',
  'bank_account_not_found',
  'expense_account_not_found',
  'income_account_not_found',
  'equity_account_not_found',
  'not_enough_money',
  'same_account',
  'future_date',
  'invalid_vat',
  'not_balanced',
  'invalid_line',
  'wallet_not_allowed',
];

/** Sends one finance action, shows its result and refreshes the page data. */
export function useFinanceAction() {
  const t = useTranslations('finance');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function send<T>(
    method: 'POST' | 'PATCH',
    path: string,
    body: unknown,
    done?: (data: T) => string,
  ) {
    setBusy(true);
    setMessage(null);
    const result = await apiSend<T>(method, path, body);
    setBusy(false);
    if (!result.ok) {
      setMessage({
        text: t(`merchants.errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`),
        error: true,
      });
      return null;
    }
    setMessage({ text: done ? done(result.data) : t('done'), error: false });
    router.refresh();
    return result.data;
  }

  return { busy, message, setMessage, send };
}

export function ActionMessage({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
    >
      {message.text}
    </p>
  );
}

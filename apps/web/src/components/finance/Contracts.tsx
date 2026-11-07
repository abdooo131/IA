'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { ReceiptField } from './ReceiptField';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// The security deposit form (Accounting). The contract itself lives in
// components/contracts (merchant contracts v2).

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-caption">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

/** Accounting receives or pays back a merchant's security deposit (second person rule). */
export function DepositForm({ merchantId }: { merchantId: string }) {
  const t = useTranslations('finance.contracts');
  const tf = useTranslations('finance');
  const { busy, message, send } = useFinanceAction();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [via, setVia] = useState<'bank' | 'wallet'>('bank');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" className={secondary} onClick={() => setOpen(true)}>
        {t('depositAction')}
      </button>
    );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const piastres = parseEgp(amount);
    if (!piastres) return;
    const done = await send('POST', `/finance/merchants/${merchantId}/deposit`, {
      direction,
      via,
      amountPiastres: piastres,
      reference,
      ...(photoId ? { receiptPhotoId: photoId } : {}),
      idempotencyKey: newActionKey(),
    });
    if (done) {
      setAmount('');
      setReference('');
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-2 sm:grid-cols-2">
      <Field label={t('direction')}>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
          className={field}
        >
          <option value="in">{t('in')}</option>
          <option value="out">{t('out')}</option>
        </select>
      </Field>
      <Field label={t('via')}>
        <select
          value={via}
          onChange={(e) => setVia(e.target.value as 'bank' | 'wallet')}
          className={field}
        >
          <option value="bank">{t('viaBank')}</option>
          <option value="wallet">{t('viaWallet')}</option>
        </select>
      </Field>
      <Field label={tf('amount')}>
        <input
          required
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('reference')}>
        <input
          required
          minLength={2}
          maxLength={100}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className={field}
        />
      </Field>
      <ReceiptField onChange={setPhotoId} />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className={primary}>
          {t('submit')}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          {tf('cancel')}
        </button>
        <ActionMessage message={message} />
      </div>
    </form>
  );
}

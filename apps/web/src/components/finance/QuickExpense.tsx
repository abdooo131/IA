'use client';

import { cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type FormEvent, useRef, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import type { BookAccount, StoreOption } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { quickExpenseBody } from '@/lib/quick-expense';
import { ReceiptField } from './ReceiptField';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// "Record an expense" (Accounting UX phase B): one short form for a cost paid from a bank or
// cash box. It goes through the same expense posting as Money movements: posted at once below
// the approval limit, otherwise it waits in Approvals for a second person.

const field =
  'mt-1 block h-11 w-full rounded-md border border-line bg-surface px-3 text-body text-text';

type Result =
  { status: 'posted'; id: string; number?: string } | { status: 'pending'; requestId: string };

export function QuickExpense({
  money,
  categories,
  stores,
  limitPiastres,
}: {
  money: BookAccount[];
  categories: BookAccount[];
  stores: StoreOption[];
  limitPiastres: number;
}) {
  const t = useTranslations('finance.quickExpense');
  const locale = useLocale();
  const action = useFinanceAction();
  const form = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [withVat, setWithVat] = useState(false);
  const [from, setFrom] = useState(money.find((a) => a.code === '1101')?.id ?? '');
  const [amountText, setAmountText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  // A fresh key per form, so a double tap or a retry posts once.
  const [key, setKey] = useState(newActionKey);
  const today = cairoDay(new Date());
  const name = (a: { nameEn: string; nameAr: string }) =>
    locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn;

  const amount = parseEgp(amountText) ?? 0;
  const source = money.find((a) => a.id === from);
  const overBalance = !!source && amount > 0 && amount > source.balancePiastres;
  const waits = limitPiastres > 0 && amount >= limitPiastres;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = quickExpenseBody(
      {
        amount: String(f.get('amount') ?? ''),
        vat: withVat ? String(f.get('vat') ?? '') : '',
        category: String(f.get('category') ?? ''),
        from: String(f.get('from') ?? ''),
        store: String(f.get('store') ?? ''),
        day: String(f.get('day') ?? ''),
        reference: String(f.get('reference') ?? ''),
        note: String(f.get('note') ?? ''),
        receiptPhotoId: String(f.get('receiptPhotoId') ?? ''),
      },
      today,
    );
    if (!body.ok) return action.setMessage({ text: t(`errors.${body.error}`), error: true });
    const r = await action.send<Result>(
      'POST',
      '/finance/expenses',
      { ...body.value, idempotencyKey: key },
      () => t('posted'),
    );
    if (r) {
      setResult(r);
      setDirty(false);
    }
  }

  const again = () => {
    form.current?.reset();
    setResult(null);
    setWithVat(false);
    setAmountText('');
    setDirty(false);
    setKey(newActionKey());
    action.setMessage(null);
  };

  if (result)
    return (
      <section className="mt-4 max-w-2xl space-y-3 rounded-lg border border-line bg-surface p-5">
        {result.status === 'posted' ? (
          <>
            <p className="text-body font-bold">{t('postedTitle')}</p>
            <p className="text-body-sm">
              <Link href={`/finance/journal/${result.id}`} className="ltr-iso font-bold text-link">
                {result.number ?? t('openEntry')}
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="text-body font-bold">{t('pendingTitle')}</p>
            <p className="text-body-sm text-text-muted">{t('pendingHint')}</p>
            <Link
              href={`/finance/approvals/${result.requestId}`}
              className="text-body-sm font-bold text-link"
            >
              {t('openRequest')}
            </Link>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={again}
            className="h-11 rounded-md bg-primary px-5 font-bold text-on-primary"
          >
            {t('another')}
          </button>
          <Link
            href="/finance"
            className="inline-flex h-11 items-center rounded-md border border-line px-4 font-bold"
          >
            {t('toDashboard')}
          </Link>
        </div>
      </section>
    );

  return (
    <form
      ref={form}
      onSubmit={(e) => void submit(e)}
      onChange={() => setDirty(true)}
      className="mt-4 grid max-w-2xl gap-4 rounded-lg border border-line bg-surface p-5 sm:grid-cols-2"
    >
      <label className="block text-caption sm:col-span-2">
        {t('amount')}
        <input
          name="amount"
          required
          inputMode="decimal"
          dir="ltr"
          autoFocus
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          className={`${field} text-h3`}
        />
      </label>
      <label className="block text-caption">
        {t('category')}
        <select name="category" required defaultValue="" className={field}>
          <option value="" disabled>
            {t('choose')}
          </option>
          {categories.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {name(a)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-caption">
        {t('store')}
        <select name="store" defaultValue="" className={field}>
          <option value="">{t('companyWide')}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {name(s)} ({s.code})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-caption">
        {t('paidFrom')}
        <select
          name="from"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={field}
        >
          <option value="" disabled>
            {t('choose')}
          </option>
          {money.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {name(a)} ({formatEgp(a.balancePiastres)})
            </option>
          ))}
        </select>
        {overBalance && <span className="mt-1 block text-danger">{t('overBalance')}</span>}
      </label>
      <label className="block text-caption">
        {t('day')}
        <DateInput name="day" max={today} defaultValue={today} dir="ltr" className={field} />
      </label>
      <div className="sm:col-span-2">
        <label className="flex min-h-11 items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={withVat}
            onChange={(e) => setWithVat(e.target.checked)}
          />
          {t('hasVat')}
        </label>
        {withVat && (
          <label className="mt-1 block text-caption">
            {t('vat')}
            <input name="vat" inputMode="decimal" dir="ltr" placeholder="0" className={field} />
            <span className="mt-1 block text-text-muted">{t('vatHint')}</span>
          </label>
        )}
      </div>
      <label className="block text-caption sm:col-span-2">
        {t('note')}
        <input name="note" required minLength={3} maxLength={300} className={field} />
      </label>
      <label className="block text-caption sm:col-span-2">
        {t('reference')}
        <input name="reference" maxLength={100} dir="auto" className={field} />
        <span className="mt-1 block text-text-muted">{t('referenceHint')}</span>
      </label>
      <ReceiptField />
      {limitPiastres > 0 && (
        <p
          className={`text-body-sm sm:col-span-2 ${waits ? 'font-semibold text-status-needs-action' : 'text-text-muted'}`}
        >
          {waits
            ? t('willWait', { limit: formatEgp(limitPiastres) })
            : t('limitHint', { limit: formatEgp(limitPiastres) })}
        </p>
      )}
      <div className="sm:col-span-2">
        <FormFooter
          dirty={dirty}
          busy={action.busy}
          saveLabel={waits ? t('sendForApproval') : t('save')}
          onCancel={again}
        />
        <ActionMessage message={action.message} />
      </div>
    </form>
  );
}

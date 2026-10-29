'use client';

import { FormFooter } from '@/components/workflow/FormFooter';
import { cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type FormEvent, useRef, useState } from 'react';
import type { BookAccount } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

export type MovementTab = 'transfer' | 'expense' | 'capital' | 'income' | 'journal';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

function label(a: BookAccount, locale: string, withBalance = false) {
  const name = locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn;
  return `${a.code} · ${name}${withBalance ? ` (${formatEgp(a.balancePiastres)})` : ''}`;
}

function AccountSelect({
  name,
  accounts,
  title,
  withBalance = false,
}: {
  name: string;
  accounts: BookAccount[];
  title: string;
  withBalance?: boolean;
}) {
  const locale = useLocale();
  return (
    <label className="block text-caption">
      {title}
      <select name={name} required className={field} defaultValue="">
        <option value="" disabled>
          …
        </option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {label(a, locale, withBalance)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Amount, reference, date and note: the same four fields on every money form. */
function Common({ memoRequired = false }: { memoRequired?: boolean }) {
  const t = useTranslations('finance.movements');
  const tf = useTranslations('finance');
  return (
    <>
      <label className="block text-caption">
        {tf('amount')} (EGP)
        <input name="amount" required inputMode="decimal" dir="ltr" className={field} />
      </label>
      <label className="block text-caption">
        {tf('reference')}
        <input name="reference" required minLength={2} dir="auto" className={field} />
      </label>
      <label className="block text-caption">
        {t('day')}
        <input
          type="date"
          name="day"
          max={cairoDay(new Date())}
          defaultValue={cairoDay(new Date())}
          dir="ltr"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {memoRequired ? t('memoRequired') : t('memo')}
        <input
          name="memo"
          required={memoRequired}
          minLength={memoRequired ? 3 : 0}
          className={field}
        />
      </label>
    </>
  );
}

function useMovement() {
  const t = useTranslations('finance.movements');
  const action = useFinanceAction();
  const ref = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  async function submit(
    e: FormEvent<HTMLFormElement>,
    path: string,
    build: (f: FormData, amount: number) => Record<string, unknown>,
  ) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const amount = parseEgp(String(f.get('amount') ?? ''));
    if (!amount) return action.setMessage({ text: t('badAmount'), error: true });
    const memo = String(f.get('memo') ?? '').trim();
    const result = await action.send<{ number: string }>(
      'POST',
      path,
      {
        amountPiastres: amount,
        reference: String(f.get('reference') ?? '').trim(),
        day: String(f.get('day') ?? '') || undefined,
        memo: memo || undefined,
        idempotencyKey: newActionKey(),
        ...build(f, amount),
      },
      (d) => t('saved', { number: d.number }),
    );
    if (result) {
      form.reset();
      setDirty(false);
    }
  }
  /** Cancel empties the form. */
  const reset = () => {
    ref.current?.reset();
    setDirty(false);
  };
  const formProps = { ref, onChange: () => setDirty(true) };
  return { action, submit, dirty, reset, formProps };
}

function Transfer({ money }: { money: BookAccount[] }) {
  const t = useTranslations('finance.movements');
  const { action, submit, dirty, reset, formProps } = useMovement();
  return (
    <form
      onSubmit={(e) =>
        void submit(e, '/finance/transfers', (f) => ({
          fromAccountId: f.get('from'),
          toAccountId: f.get('to'),
        }))
      }
      {...formProps}
      className="grid gap-3 sm:grid-cols-2"
    >
      <AccountSelect name="from" accounts={money} title={t('from')} withBalance />
      <AccountSelect name="to" accounts={money} title={t('to')} withBalance />
      <Common />
      <Submit busy={action.busy} dirty={dirty} onCancel={reset} />
      <ActionMessage message={action.message} />
    </form>
  );
}

function Expense({ money, expenses }: { money: BookAccount[]; expenses: BookAccount[] }) {
  const t = useTranslations('finance.movements');
  const { action, submit, dirty, reset, formProps } = useMovement();
  return (
    <form
      onSubmit={(e) =>
        void submit(e, '/finance/expenses', (f) => ({
          expenseAccountId: f.get('expense'),
          paidFromAccountId: f.get('from'),
          vatPiastres: parseEgp(String(f.get('vat') || '0')) ?? 0,
        }))
      }
      {...formProps}
      className="grid gap-3 sm:grid-cols-2"
    >
      <AccountSelect name="expense" accounts={expenses} title={t('category')} />
      <AccountSelect name="from" accounts={money} title={t('paidFrom')} withBalance />
      <Common memoRequired />
      <label className="block text-caption">
        {t('vat')}
        <input name="vat" inputMode="decimal" dir="ltr" placeholder="0" className={field} />
      </label>
      <Submit busy={action.busy} dirty={dirty} onCancel={reset} />
      <ActionMessage message={action.message} />
    </form>
  );
}

function Capital({ money, equity }: { money: BookAccount[]; equity: BookAccount[] }) {
  const t = useTranslations('finance.movements');
  const { action, submit, dirty, reset, formProps } = useMovement();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  return (
    <form
      onSubmit={(e) =>
        void submit(e, '/finance/capital', (f) => ({
          direction,
          moneyAccountId: f.get('money'),
          equityAccountId: f.get('equity') || undefined,
        }))
      }
      {...formProps}
      className="grid gap-3 sm:grid-cols-2"
    >
      <fieldset className="flex gap-4 text-body-sm sm:col-span-2">
        <legend className="text-caption">{t('direction')}</legend>
        {(['in', 'out'] as const).map((d) => (
          <label key={d} className="flex items-center gap-2">
            <input
              type="radio"
              checked={direction === d}
              onChange={() => setDirection(d)}
              name="direction"
            />
            {t(`directions.${d}`)}
          </label>
        ))}
      </fieldset>
      <AccountSelect
        name="money"
        accounts={money}
        title={direction === 'in' ? t('to') : t('from')}
        withBalance
      />
      <label className="block text-caption">
        {t('equity')}
        <select name="equity" className={field} defaultValue="">
          <option value="">
            {direction === 'in' ? '3101' : '3201'} · {t('defaultEquity')}
          </option>
          {equity.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.nameEn}
            </option>
          ))}
        </select>
      </label>
      <Common />
      <Submit busy={action.busy} dirty={dirty} onCancel={reset} />
      <ActionMessage message={action.message} />
    </form>
  );
}

function Income({ money, income }: { money: BookAccount[]; income: BookAccount[] }) {
  const t = useTranslations('finance.movements');
  const { action, submit, dirty, reset, formProps } = useMovement();
  return (
    <form
      onSubmit={(e) =>
        void submit(e, '/finance/other-income', (f) => ({
          incomeAccountId: f.get('income'),
          moneyAccountId: f.get('money'),
        }))
      }
      {...formProps}
      className="grid gap-3 sm:grid-cols-2"
    >
      <AccountSelect name="income" accounts={income} title={t('incomeAccount')} />
      <AccountSelect name="money" accounts={money} title={t('to')} withBalance />
      <Common memoRequired />
      <Submit busy={action.busy} dirty={dirty} onCancel={reset} />
      <ActionMessage message={action.message} />
    </form>
  );
}

interface JournalLine {
  accountId: string;
  debit: string;
  credit: string;
}

/** A free entry for the accountant: as many lines as needed, debits must equal credits. */
function Journal({ accounts }: { accounts: BookAccount[] }) {
  const t = useTranslations('finance.movements');
  const tj = useTranslations('finance.journal');
  const locale = useLocale();
  const action = useFinanceAction();
  const empty = (): JournalLine => ({ accountId: '', debit: '', credit: '' });
  const [lines, setLines] = useState<JournalLine[]>([empty(), empty()]);
  const [reason, setReason] = useState('');
  const [day, setDay] = useState(cairoDay(new Date()));
  const amount = (v: string) => (v.trim() ? parseEgp(v) : 0);
  const debit = lines.reduce((s, l) => s + (amount(l.debit) ?? 0), 0);
  const credit = lines.reduce((s, l) => s + (amount(l.credit) ?? 0), 0);
  const dirty = reason !== '' || lines.some((l) => l.accountId || l.debit || l.credit);
  const set = (i: number, patch: Partial<JournalLine>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  // Merchant and rider wallets have their own screens; store cash boxes are allowed.
  const allowed = accounts.filter((a) => !a.wallet || a.groupCode === 1200);

  async function save() {
    const body = lines
      .filter((l) => l.accountId)
      .map((l) => ({
        accountId: l.accountId,
        debitPiastres: amount(l.debit) ?? -1,
        creditPiastres: amount(l.credit) ?? -1,
      }));
    const ok = await action.send<{ number: string }>(
      'POST',
      '/finance/journal-entries',
      { lines: body, reason, day, idempotencyKey: newActionKey() },
      (d) => t('saved', { number: d.number }),
    );
    if (ok) {
      setLines([empty(), empty()]);
      setReason('');
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-body-sm text-text-muted">{t('journalIntro')}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-body-sm">
          <thead>
            <tr className="text-start text-caption text-text-muted">
              <th className="py-1 text-start">{tj('account')}</th>
              <th className="py-1 text-start">{tj('debit')}</th>
              <th className="py-1 text-start">{tj('credit')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pe-2">
                  <select
                    value={l.accountId}
                    onChange={(e) => set(i, { accountId: e.target.value })}
                    className={field}
                    aria-label={tj('account')}
                  >
                    <option value="">…</option>
                    {allowed.map((a) => (
                      <option key={a.id} value={a.id}>
                        {label(a, locale)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="w-36 py-1 pe-2">
                  <input
                    value={l.debit}
                    onChange={(e) => set(i, { debit: e.target.value, credit: '' })}
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={tj('debit')}
                    className={field}
                  />
                </td>
                <td className="w-36 py-1 pe-2">
                  <input
                    value={l.credit}
                    onChange={(e) => set(i, { credit: e.target.value, debit: '' })}
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={tj('credit')}
                    className={field}
                  />
                </td>
                <td className="py-1">
                  {lines.length > 2 && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      aria-label={t('removeLine')}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="py-1">{t('totals')}</td>
              <td className="ltr-iso py-1">{formatEgp(debit)}</td>
              <td className="ltr-iso py-1">{formatEgp(credit)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {debit !== credit && (
        <p className="text-body-sm text-danger">
          {t('difference', { amount: formatEgp(Math.abs(debit - credit)) })}
        </p>
      )}
      <button
        type="button"
        className={button}
        onClick={() => setLines([...lines, empty()])}
        disabled={lines.length >= 20}
      >
        {t('addLine')}
      </button>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-caption">
          {t('reason')}
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
        </label>
        <label className="block text-caption">
          {t('day')}
          <input
            type="date"
            value={day}
            max={cairoDay(new Date())}
            onChange={(e) => setDay(e.target.value)}
            dir="ltr"
            className={field}
          />
        </label>
      </div>
      <FormFooter
        dirty={dirty}
        busy={action.busy}
        saveLabel={t('save')}
        disabled={debit === 0 || debit !== credit || reason.trim().length < 5}
        onSave={() => void save()}
        onCancel={() => {
          setLines([empty(), empty()]);
          setReason('');
        }}
      />
      <ActionMessage message={action.message} />
    </div>
  );
}

function Submit({
  busy,
  dirty,
  onCancel,
}: {
  busy: boolean;
  dirty: boolean;
  onCancel: () => void;
}) {
  const t = useTranslations('finance.movements');
  return (
    <div className="sm:col-span-2">
      <FormFooter dirty={dirty} busy={busy} saveLabel={t('save')} onCancel={onCancel} />
    </div>
  );
}

export function MoneyMovements({ accounts, tab }: { accounts: BookAccount[]; tab: MovementTab }) {
  const t = useTranslations('finance.movements');
  const money = accounts.filter((a) => a.money);
  const byGroup = (...codes: number[]) => accounts.filter((a) => codes.includes(a.groupCode));
  const tabs: MovementTab[] = ['transfer', 'expense', 'capital', 'income', 'journal'];
  const link = (k: MovementTab) =>
    `rounded-md px-4 py-2 text-body-sm font-bold ${k === tab ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  return (
    <div className="mt-4 max-w-3xl">
      <nav className="flex flex-wrap gap-2">
        {tabs.map((k) => (
          <Link key={k} href={`/finance/movements?tab=${k}`} className={link(k)}>
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>
      <section className="mt-4 rounded-lg border border-line bg-surface p-4">
        <p className="mb-3 text-body-sm text-text-muted">{t(`help.${tab}`)}</p>
        {tab === 'transfer' && <Transfer money={money} />}
        {tab === 'expense' && <Expense money={money} expenses={byGroup(5400, 5500)} />}
        {tab === 'capital' && <Capital money={money} equity={byGroup(3100, 3200)} />}
        {tab === 'income' && <Income money={money} income={byGroup(4200)} />}
        {tab === 'journal' && <Journal accounts={accounts} />}
      </section>
    </div>
  );
}

'use client';

import { addDays, bankName, cairoDay, EGYPT_BANKS, loanSchedule } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { inClosedBooks } from '@/lib/books-lock';
import { isoToDayFirst } from '@/lib/day-first';
import type { BookAccount } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { useAttachments } from './AttachmentField';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// Loans the company borrowed, the user's own cost tags and the month end revaluation of
// bank accounts in another currency. Every word is in the loansFx messages.

/** The bank list's last choice: a bank not on the list, typed by hand. */
const OTHER = '__other__';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const button =
  'h-9 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-line disabled:text-text-muted';
const th = 'py-2 pe-3 text-start text-caption font-semibold text-text-muted';
const td = 'py-2 pe-3 align-top';

const accountLabel = (a: BookAccount, locale: string) =>
  `${a.code} · ${locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn} (${formatEgp(a.balancePiastres)})`;
/** Basis points as a percent with up to two decimals: 2250 → "22.5" */
const percent = (bp: number) => String(bp / 100);

// ─── loans ──────────────────────────────────────────────────────────────────────

export interface LoanRow {
  id: string;
  number: string;
  lender: 'supplier' | 'owner';
  lenderName: string;
  principalPiastres: number;
  owedPiastres: number;
  interestLeftPiastres: number;
  annualRateBp: number;
  method: 'declining' | 'flat';
  months: number;
  paid: number;
  startDay: string;
  status: 'active' | 'repaid';
  account: { id: string; code: string };
  next: { seq: number; dueDay: string; instalmentPiastres: number; overdue: boolean } | null;
}

export interface LoanDetailData {
  id: string;
  number: string;
  lenderName: string;
  principalPiastres: number;
  owedPiastres: number;
  annualRateBp: number;
  method: 'declining' | 'flat';
  months: number;
  startDay: string;
  firstPaymentDay: string;
  reference: string;
  memo: string | null;
  status: 'active' | 'repaid';
  account: { id: string; code: string; nameEn: string | null; nameAr: string | null };
  moneyAccount: { id: string; code: string; nameEn: string | null; nameAr: string | null };
  entry: { id: string; number: number };
  totals: { instalmentPiastres: number; interestPiastres: number; principalPiastres: number };
  instalments: {
    seq: number;
    dueDay: string;
    instalmentPiastres: number;
    interestPiastres: number;
    principalPiastres: number;
    remainingPiastres: number;
    paidAt: string | null;
    entry: { id: string; number: number } | null;
  }[];
  nextSeq: number | null;
}

/** A loan received from a bank: the bank, amount, where it came in, rate, method and the schedule. */
export function NewLoan({
  money,
  openFrom,
}: {
  money: BookAccount[];
  /** The first day the books are open (the day after they were closed through); null: all */
  openFrom?: string | null;
}) {
  const t = useTranslations('loansFx.loans');
  const locale = useLocale();
  const action = useFinanceAction();
  const files = useAttachments();
  const today = cairoDay(new Date());
  const blank = {
    /** One of EGYPT_BANKS (English name), or OTHER with the name typed in otherBank */
    bank: '',
    otherBank: '',
    amount: '',
    rate: '',
    method: 'declining' as 'declining' | 'flat',
    months: '12',
    startDay: today,
    firstPaymentDay: addDays(today, 30),
    moneyAccountId: money.find((a) => a.code === '1101')?.id ?? '',
    reference: '',
    memo: '',
  };
  const [l, setL] = useState(blank);
  const [key, setKey] = useState(newActionKey);
  const principal = parseEgp(l.amount);
  // The rate as typed ("22.5") to basis points without a float: same rule as money.
  const rateBp = l.rate.trim() === '' ? null : parseEgp(l.rate);
  const months = /^\d{1,3}$/.test(l.months) ? Number(l.months) : 0;
  let preview: ReturnType<typeof loanSchedule> | null = null;
  try {
    if (principal && rateBp !== null && months >= 1 && l.firstPaymentDay > l.startDay)
      preview = loanSchedule({
        principalPiastres: principal,
        annualRateBp: rateBp,
        months,
        method: l.method,
        firstPaymentDay: l.firstPaymentDay,
      });
  } catch {
    preview = null;
  }
  const lenderName = (l.bank === OTHER ? l.otherBank : l.bank).trim();
  const dirty = JSON.stringify(l) !== JSON.stringify(blank);
  // A day inside closed books would be refused: say so before sending.
  const closedDay = inClosedBooks(l.startDay, openFrom);
  const ready =
    !!preview &&
    !closedDay &&
    !!l.moneyAccountId &&
    l.reference.trim().length >= 2 &&
    lenderName.length >= 2;

  async function save() {
    const ok = await action.send(
      'POST',
      '/finance/loans',
      {
        lender: 'bank',
        lenderName,
        principalPiastres: principal,
        moneyAccountId: l.moneyAccountId,
        startDay: l.startDay,
        annualRateBp: rateBp,
        method: l.method,
        months,
        firstPaymentDay: l.firstPaymentDay,
        reference: l.reference.trim(),
        memo: l.memo.trim() || undefined,
        attachmentIds: files.ids,
        idempotencyKey: key,
      },
      () => t('saved'),
    );
    if (ok) {
      setL(blank);
      files.reset();
      setKey(newActionKey());
    }
  }

  return (
    <section className="max-w-3xl space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('new')}</h2>
      <p className="text-caption text-text-muted">{t('newHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-caption">
          {t('bank')}
          <select
            value={l.bank}
            onChange={(e) => setL({ ...l, bank: e.target.value })}
            className={field}
          >
            <option value="">{t('choose')}</option>
            {EGYPT_BANKS.map((b) => (
              <option key={b.en} value={b.en}>
                {locale === 'ar' ? b.ar : b.en}
              </option>
            ))}
            <option value={OTHER}>{t('otherBank')}</option>
          </select>
        </label>
        {l.bank === OTHER && (
          <label className="block text-caption">
            {t('otherBankName')}
            <input
              value={l.otherBank}
              onChange={(e) => setL({ ...l, otherBank: e.target.value })}
              className={field}
            />
          </label>
        )}
        <label className="block text-caption">
          {t('receivedInto')}
          <select
            value={l.moneyAccountId}
            onChange={(e) => setL({ ...l, moneyAccountId: e.target.value })}
            className={field}
          >
            <option value="">{t('choose')}</option>
            {money.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('amount')}
          <input
            value={l.amount}
            onChange={(e) => setL({ ...l, amount: e.target.value })}
            inputMode="decimal"
            dir="ltr"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('rate')}
          <input
            value={l.rate}
            onChange={(e) => setL({ ...l, rate: e.target.value })}
            inputMode="decimal"
            dir="ltr"
            placeholder="22.5"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('method')}
          <select
            value={l.method}
            onChange={(e) => setL({ ...l, method: e.target.value as 'declining' | 'flat' })}
            className={field}
          >
            {(['declining', 'flat'] as const).map((m) => (
              <option key={m} value={m}>
                {t(`methods.${m}`)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-text-muted">{t(`methodHints.${l.method}`)}</span>
        </label>
        <label className="block text-caption">
          {t('months')}
          <input
            value={l.months}
            onChange={(e) => setL({ ...l, months: e.target.value })}
            inputMode="numeric"
            dir="ltr"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('startDay')}
          <DateInput
            value={l.startDay}
            max={today}
            min={openFrom ?? undefined}
            onChange={(e) => setL({ ...l, startDay: e.target.value })}
            dir="ltr"
            className={field}
          />
          {closedDay && (
            <span role="alert" className="mt-1 block text-danger">
              {t('booksClosed', { day: isoToDayFirst(openFrom!) })}
            </span>
          )}
        </label>
        <label className="block text-caption">
          {t('firstPaymentDay')}
          <DateInput
            value={l.firstPaymentDay}
            onChange={(e) => setL({ ...l, firstPaymentDay: e.target.value })}
            dir="ltr"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('reference')}
          <input
            value={l.reference}
            onChange={(e) => setL({ ...l, reference: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('memo')}
          <input
            value={l.memo}
            onChange={(e) => setL({ ...l, memo: e.target.value })}
            className={field}
          />
        </label>
      </div>
      {preview && (
        <div className="rounded-md border border-line p-3 text-body-sm">
          <p className="font-bold">
            {t('preview', {
              instalment: formatEgp(preview[0]!.instalmentPiastres),
              months: preview.length,
            })}
          </p>
          <p className="text-text-muted">
            {t('previewTotals', {
              interest: formatEgp(preview.reduce((s, r) => s + r.interestPiastres, 0)),
              total: formatEgp(preview.reduce((s, r) => s + r.instalmentPiastres, 0)),
              last: isoToDayFirst(preview.at(-1)!.dueDay),
            })}
          </p>
        </div>
      )}
      {files.field()}
      <FormFooter
        dirty={dirty}
        busy={action.busy}
        saveLabel={t('save')}
        disabled={!ready || files.busy}
        onSave={() => void save()}
        onCancel={() => setL(blank)}
      />
      <ActionMessage message={action.message} />
    </section>
  );
}

/** Every loan with what is still owed and its next instalment. */
export function LoansTable({ loans }: { loans: LoanRow[] }) {
  const t = useTranslations('loansFx.loans');
  const locale = useLocale();
  if (loans.length === 0) return <p className="text-body-sm text-text-muted">{t('none')}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface p-3">
      <table className="w-full min-w-[720px] text-body-sm">
        <thead>
          <tr className="border-b border-line">
            <th className={th}>{t('number')}</th>
            <th className={th}>{t('lender')}</th>
            <th className={`${th} text-end`}>{t('amount')}</th>
            <th className={`${th} text-end`}>{t('owed')}</th>
            <th className={th}>{t('rateShort')}</th>
            <th className={th}>{t('paidOf')}</th>
            <th className={th}>{t('next')}</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className={td}>
                <Link href={`/finance/loans/${l.id}`} className="ltr-iso font-bold text-link">
                  {l.number}
                </Link>
                <span className="ltr-iso block text-caption text-text-muted">{l.account.code}</span>
              </td>
              <td className={td}>{bankName(l.lenderName, locale)}</td>
              <td className={`${td} text-end`}>
                <Amount piastres={l.principalPiastres} />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={l.owedPiastres} strong />
              </td>
              <td className={td}>
                <span className="ltr-iso">{percent(l.annualRateBp)}%</span> ·{' '}
                {t(`methods.${l.method}`)}
              </td>
              <td className={td}>
                <span className="ltr-iso">
                  {l.paid} / {l.months}
                </span>
              </td>
              <td className={td}>
                {l.status === 'repaid' || !l.next ? (
                  t('repaid')
                ) : (
                  <span className={l.next.overdue ? 'text-danger' : ''}>
                    <span className="ltr-iso">{isoToDayFirst(l.next.dueDay)}</span> ·{' '}
                    <Amount piastres={l.next.instalmentPiastres} />
                    {l.next.overdue && <span className="ms-1">({t('overdue')})</span>}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One loan: its schedule, which instalments are paid (with their entries) and Pay next. */
export function LoanDetail({ loan, money }: { loan: LoanDetailData; money: BookAccount[] }) {
  const t = useTranslations('loansFx.loans');
  const locale = useLocale();
  const action = useFinanceAction();
  const files = useAttachments();
  const today = cairoDay(new Date());
  const [from, setFrom] = useState(loan.moneyAccount.id);
  const [reference, setReference] = useState('');
  const [day, setDay] = useState(today);
  const [key, setKey] = useState(newActionKey);
  const next = loan.instalments.find((i) => i.seq === loan.nextSeq);
  const name = (a: { nameEn: string | null; nameAr: string | null }) =>
    (locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn) ?? '';

  async function pay() {
    const ok = await action.send<{ number?: string }>(
      'POST',
      `/finance/loans/${loan.id}/pay`,
      {
        moneyAccountId: from,
        reference: reference.trim(),
        day,
        attachmentIds: files.ids,
        idempotencyKey: key,
      },
      (d) => t('paid', { number: d.number ?? '' }),
    );
    if (ok) {
      setReference('');
      files.reset();
      setKey(newActionKey());
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['amount', loan.principalPiastres],
          ['owed', loan.owedPiastres],
          ['interestTotal', loan.totals.interestPiastres],
          ['totalToPay', loan.totals.instalmentPiastres],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-line bg-surface p-3">
            <p className="text-label uppercase text-text-muted">{t(k as string)}</p>
            <p className="mt-1 text-h3">
              <Amount piastres={v as number} strong />
            </p>
          </div>
        ))}
      </div>
      <p className="text-body-sm text-text-muted">
        {t('summary', {
          lender: bankName(loan.lenderName, locale),
          rate: percent(loan.annualRateBp),
          method: t(`methods.${loan.method}`),
          months: loan.months,
          start: isoToDayFirst(loan.startDay),
        })}{' '}
        <Link href={`/finance/accounts/${loan.account.id}`} className="text-link">
          {loan.account.code} · {name(loan.account)}
        </Link>
        {' · '}
        <Link href={`/finance/journal/${loan.entry.id}`} className="text-link">
          {t('receivedEntry')}
        </Link>
      </p>

      {next && (
        <section className="max-w-3xl space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">
            {t('payNext', { seq: next.seq, due: isoToDayFirst(next.dueDay) })}
          </h2>
          <p className="text-body-sm">
            {t('payNextSplit', {
              amount: formatEgp(next.instalmentPiastres),
              principal: formatEgp(next.principalPiastres),
              interest: formatEgp(next.interestPiastres),
            })}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-caption">
              {t('paidFrom')}
              <select value={from} onChange={(e) => setFrom(e.target.value)} className={field}>
                {money.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-caption">
              {t('reference')}
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('payDay')}
              <DateInput
                value={day}
                max={today}
                onChange={(e) => setDay(e.target.value)}
                dir="ltr"
                className={field}
              />
            </label>
          </div>
          {files.field()}
          <button
            type="button"
            className={primary}
            disabled={action.busy || files.busy || reference.trim().length < 2 || !from}
            onClick={() => void pay()}
          >
            {t('pay')}
          </button>
          <ActionMessage message={action.message} />
        </section>
      )}

      <section className="overflow-x-auto rounded-lg border border-line bg-surface p-3">
        <h2 className="text-h3">{t('schedule')}</h2>
        <table className="mt-2 w-full min-w-[720px] text-body-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>#</th>
              <th className={th}>{t('due')}</th>
              <th className={`${th} text-end`}>{t('instalment')}</th>
              <th className={`${th} text-end`}>{t('principal')}</th>
              <th className={`${th} text-end`}>{t('interest')}</th>
              <th className={`${th} text-end`}>{t('remaining')}</th>
              <th className={th}>{t('state')}</th>
            </tr>
          </thead>
          <tbody>
            {loan.instalments.map((i) => {
              const overdue = !i.paidAt && i.dueDay < today;
              return (
                <tr key={i.seq} className="border-b border-line">
                  <td className={`${td} ltr-iso`}>{i.seq}</td>
                  <td className={`${td} ltr-iso ${overdue ? 'text-danger' : ''}`}>
                    {isoToDayFirst(i.dueDay)}
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={i.instalmentPiastres} strong />
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={i.principalPiastres} />
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={i.interestPiastres} />
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={i.remainingPiastres} />
                  </td>
                  <td className={td}>
                    {i.paidAt && i.entry ? (
                      <Link href={`/finance/journal/${i.entry.id}`} className="text-link">
                        {t('paidState')}
                      </Link>
                    ) : overdue ? (
                      <span className="text-danger">{t('overdue')}</span>
                    ) : (
                      <span className="text-text-muted">{t('unpaid')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="font-bold">
              <td className={td} colSpan={2}>
                {t('totals')}
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={loan.totals.instalmentPiastres} />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={loan.totals.principalPiastres} />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={loan.totals.interestPiastres} />
              </td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─── cost tags ──────────────────────────────────────────────────────────────────

export interface CostTagRow {
  id: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  lines: number;
}

/** Accounting manage opens, renames and switches off cost tags. */
export function CostTagsManager({ tags }: { tags: CostTagRow[] }) {
  const t = useTranslations('loansFx.tags');
  const locale = useLocale();
  const action = useFinanceAction();
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const dirty = nameEn !== '' || nameAr !== '';
  async function create() {
    const ok = await action.send('POST', '/finance/cost-tags', {
      nameEn: nameEn.trim(),
      nameAr: nameAr.trim(),
    });
    if (ok) {
      setNameEn('');
      setNameAr('');
    }
  }
  return (
    <div className="mt-4 space-y-4">
      <section className="max-w-2xl space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('new')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-caption">
            {t('nameEn')}
            <input
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              dir="ltr"
              className={field}
            />
          </label>
          <label className="block text-caption">
            {t('nameAr')}
            <input
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              dir="rtl"
              className={field}
            />
          </label>
        </div>
        <FormFooter
          dirty={dirty}
          busy={action.busy}
          saveLabel={t('save')}
          disabled={nameEn.trim().length < 2 || nameAr.trim().length < 2}
          onSave={() => void create()}
          onCancel={() => {
            setNameEn('');
            setNameAr('');
          }}
        />
        <ActionMessage message={action.message} />
      </section>
      {tags.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="max-w-2xl divide-y divide-line rounded-lg border border-line bg-surface px-4">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className={`flex flex-wrap items-center gap-3 py-2 ${tag.isActive ? '' : 'opacity-60'}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold">{locale === 'ar' ? tag.nameAr : tag.nameEn}</p>
                <p className="text-caption text-text-muted">{t('lines', { count: tag.lines })}</p>
              </div>
              <button
                type="button"
                className={button}
                disabled={action.busy}
                onClick={() =>
                  void action.send('PATCH', `/finance/cost-tags/${tag.id}`, {
                    isActive: !tag.isActive,
                  })
                }
              >
                {tag.isActive ? t('switchOff') : t('switchOn')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── bank accounts in another currency ───────────────────────────────────────────

/** Month end revaluation of one account at the rate the person enters. */
export function RevalueForm({
  accountId,
  currency,
  onDone,
}: {
  accountId: string;
  currency: string;
  onDone: () => void;
}) {
  const t = useTranslations('loansFx.fx');
  const action = useFinanceAction();
  const lastMonth = addDays(`${cairoDay(new Date()).slice(0, 7)}-01`, -1).slice(0, 7);
  const [month, setMonth] = useState(lastMonth);
  const [rate, setRate] = useState('');
  const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && /^\d{1,6}(\.\d{1,6})?$/.test(rate.trim());
  return (
    <div className="mt-2 grid gap-2 rounded-md border border-line p-3 sm:grid-cols-3">
      <p className="text-caption text-text-muted sm:col-span-3">{t('revalueHint')}</p>
      <label className="block text-caption">
        {t('month')}
        <input
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          dir="ltr"
          placeholder="2026-10"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('rate', { currency })}
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          dir="ltr"
          placeholder="48.75"
          className={field}
        />
      </label>
      <div className="flex items-end gap-2">
        <button
          type="button"
          className={primary}
          disabled={!ok || action.busy}
          onClick={() =>
            void action
              .send<{ differencePiastres: number }>(
                'POST',
                `/finance/accounts/${accountId}/revalue`,
                { month, fxRate: rate.trim() },
                (d) => t('revalued', { amount: formatEgp(d.differencePiastres) }),
              )
              .then((done) => done && setRate(''))
          }
        >
          {t('revalue')}
        </button>
        <button type="button" className={button} onClick={onDone}>
          {t('close')}
        </button>
      </div>
      <div className="sm:col-span-3">
        <ActionMessage message={action.message} />
      </div>
    </div>
  );
}

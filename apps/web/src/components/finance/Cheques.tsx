'use client';

import {
  cairoDay,
  type ChequeDirectionName,
  type ChequePurposeName,
  ISSUED_PURPOSES,
  RECEIVED_PURPOSES,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { isoToDayFirst } from '@/lib/day-first';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { AttachmentField } from './AttachmentField';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// The cheques register: the list with its due panel, the form to register a cheque received
// or issued, and the actions on one cheque (deposit, clear, bounce, cancel).

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';
const danger =
  'h-10 rounded-md border border-danger px-3 text-body-sm font-bold text-danger disabled:opacity-50';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

export interface ChequeRow {
  id: string;
  number: number;
  label: string;
  direction: ChequeDirectionName;
  purpose: ChequePurposeName;
  status: string;
  chequeNumber: string;
  bankName: string;
  partyName: string;
  amountPiastres: number;
  issueDate: string;
  dueDate: string;
}

export interface ChequeDetail extends ChequeRow {
  note: string | null;
  photoId: string | null;
  merchant: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  bill: { id: string; number: number; reference: string } | null;
  payout: { id: string; number: number } | null;
  bankAccount: { id: string; code: string; nameEn: string; nameAr: string } | null;
  incomeAccount: { id: string; code: string; nameEn: string; nameAr: string } | null;
  bookEntry: { id: string; number: string } | null;
  clearEntry: { id: string; number: string } | null;
  reverseEntry: { id: string; number: string } | null;
  bounceReason: string | null;
  cancelNote: string | null;
  createdBy: string;
  requestId: string | null;
}

export interface ChequeOptions {
  merchants: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  bills: { id: string; numberLabel: string; reference: string; supplier: { name: string } }[];
  payouts: { id: string; number: string; merchant: { name: string }; amountPiastres: number }[];
  banks: { id: string; code: string; nameEn: string; nameAr: string }[];
  incomeAccounts: { id: string; code: string; nameEn: string; nameAr: string }[];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-caption">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export function ChequeStatusPill({ status }: { status: string }) {
  const t = useTranslations('finance.cheques');
  const tone =
    status === 'bounced' || status === 'cancelled'
      ? 'text-danger'
      : status === 'cleared'
        ? 'text-success'
        : 'text-text-muted';
  return (
    <span className={`rounded-pill border border-line px-2.5 py-0.5 text-caption ${tone}`}>
      {t(`statuses.${status}`)}
    </span>
  );
}

/** The register (or a part of it) as a table. */
export function ChequesTable({ cheques }: { cheques: ChequeRow[] }) {
  const t = useTranslations('finance.cheques');
  if (!cheques.length) return <p className="text-body-sm text-text-muted">{t('empty')}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-body-sm">
        <thead>
          <tr>
            <th className={th}>{t('number')}</th>
            <th className={th}>{t('direction')}</th>
            <th className={th}>{t('party')}</th>
            <th className={th}>{t('chequeNumber')}</th>
            <th className={th}>{t('dueDate')}</th>
            <th className={`${th} text-end`}>{t('amount')}</th>
            <th className={th}>{t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {cheques.map((c) => (
            <tr key={c.id} className="border-t border-line">
              <td className={td}>
                <Link
                  href={`/finance/cheques/${c.id}`}
                  className="ltr-iso whitespace-nowrap font-bold text-link"
                >
                  {c.label}
                </Link>
              </td>
              <td className={td}>
                {t(`directions.${c.direction}`)}
                <span className="block text-caption text-text-muted">
                  {t(`purposes.${c.purpose}`)}
                </span>
              </td>
              <td className={td}>
                {c.partyName}
                <span className="block text-caption text-text-muted">{c.bankName}</span>
              </td>
              <td className={`${td} ltr-iso`}>{c.chequeNumber}</td>
              <td className={`${td} ltr-iso`}>{isoToDayFirst(c.dueDate)}</td>
              <td className={`${td} text-end`}>
                <Amount piastres={c.amountPiastres} />
              </td>
              <td className={td}>
                <ChequeStatusPill status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Registers a cheque received or issued; it books at once or waits for a second person. */
export function ChequeRegisterForm({ options }: { options: ChequeOptions }) {
  const t = useTranslations('finance.cheques');
  const locale = useLocale();
  const { busy, message, send } = useFinanceAction();
  const today = cairoDay(new Date());
  const [direction, setDirection] = useState<ChequeDirectionName>('received');
  const [purpose, setPurpose] = useState<ChequePurposeName>('merchant');
  const [form, setForm] = useState({
    chequeNumber: '',
    bankName: '',
    partyName: '',
    amount: '',
    issueDate: today,
    dueDate: today,
    merchantId: '',
    supplierId: '',
    billId: '',
    payoutId: '',
    incomeAccountId: '',
    bankAccountId: options.banks[0]?.id ?? '',
    note: '',
  });
  const [files, setFiles] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const name = (a: { code: string; nameEn: string; nameAr: string }) =>
    `${a.code} ${locale === 'ar' ? a.nameAr : a.nameEn}`;
  const purposes = direction === 'received' ? RECEIVED_PURPOSES : ISSUED_PURPOSES;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const amount = parseEgp(form.amount);
    const done = await send<{ status: string }>(
      'POST',
      '/finance/cheques',
      {
        direction,
        purpose,
        chequeNumber: form.chequeNumber,
        ...(direction === 'received' ? { bankName: form.bankName } : {}),
        ...(form.partyName.trim() ? { partyName: form.partyName } : {}),
        ...(purpose !== 'payout' && amount ? { amountPiastres: amount } : {}),
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        ...(purpose === 'merchant' || purpose === 'deposit' || purpose === 'deposit_refund'
          ? { merchantId: form.merchantId }
          : {}),
        ...(purpose === 'supplier' ? { supplierId: form.supplierId } : {}),
        ...(purpose === 'bill' ? { billId: form.billId } : {}),
        ...(purpose === 'payout' ? { payoutId: form.payoutId } : {}),
        ...(purpose === 'other_income' ? { incomeAccountId: form.incomeAccountId } : {}),
        ...(direction === 'issued' ? { bankAccountId: form.bankAccountId } : {}),
        ...(form.note.trim() ? { note: form.note } : {}),
        attachmentIds: files,
        idempotencyKey: newActionKey(),
      },
      // A payout cheque waits for the payout checks before it pays the payout.
      (data) =>
        data.status === 'awaiting_checks' ? t('registeredWaitingChecks') : t('registered'),
    );
    if (done) {
      setForm((f) => ({ ...f, chequeNumber: '', amount: '', partyName: '', note: '' }));
      formEl.reset();
      setRound((r) => r + 1);
    }
  }

  const choose = (
    value: string,
    onChange: (v: string) => void,
    items: { id: string; label: string }[],
    label: string,
  ) => (
    <select
      required
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={field}
    >
      <option value="">{t('choose')}</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.label}
        </option>
      ))}
    </select>
  );

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2"
    >
      <h2 className="text-h3 sm:col-span-2">{t('register')}</h2>
      <Field label={t('direction')}>
        <select
          value={direction}
          onChange={(e) => {
            const d = e.target.value as ChequeDirectionName;
            setDirection(d);
            setPurpose(d === 'received' ? 'merchant' : 'bill');
          }}
          className={field}
        >
          <option value="received">{t('directions.received')}</option>
          <option value="issued">{t('directions.issued')}</option>
        </select>
      </Field>
      <Field label={t('purpose')}>
        <select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as ChequePurposeName)}
          className={field}
        >
          {purposes.map((p) => (
            <option key={p} value={p}>
              {t(`purposes.${p}`)}
            </option>
          ))}
        </select>
      </Field>
      {(purpose === 'merchant' || purpose === 'deposit' || purpose === 'deposit_refund') && (
        <Field label={t('merchant')}>
          {choose(
            form.merchantId,
            set('merchantId'),
            options.merchants.map((m) => ({ id: m.id, label: m.name })),
            t('merchant'),
          )}
        </Field>
      )}
      {purpose === 'supplier' && (
        <Field label={t('supplier')}>
          {choose(
            form.supplierId,
            set('supplierId'),
            options.suppliers.map((s) => ({ id: s.id, label: s.name })),
            t('supplier'),
          )}
        </Field>
      )}
      {purpose === 'other_income' && (
        <Field label={t('incomeAccount')}>
          {choose(
            form.incomeAccountId,
            set('incomeAccountId'),
            options.incomeAccounts.map((a) => ({ id: a.id, label: name(a) })),
            t('incomeAccount'),
          )}
        </Field>
      )}
      {purpose === 'bill' && (
        <Field label={t('bill')}>
          {choose(
            form.billId,
            set('billId'),
            options.bills.map((b) => ({
              id: b.id,
              label: `${b.numberLabel} · ${b.supplier.name} · ${b.reference}`,
            })),
            t('bill'),
          )}
        </Field>
      )}
      {purpose === 'payout' && (
        <Field label={t('payout')}>
          {choose(
            form.payoutId,
            set('payoutId'),
            options.payouts.map((p) => ({
              id: p.id,
              label: `${p.number} · ${p.merchant.name} · ${formatEgp(p.amountPiastres)}`,
            })),
            t('payout'),
          )}
        </Field>
      )}
      {direction === 'issued' ? (
        <Field label={t('ourBank')}>
          {choose(
            form.bankAccountId,
            set('bankAccountId'),
            options.banks.map((b) => ({ id: b.id, label: name(b) })),
            t('ourBank'),
          )}
        </Field>
      ) : (
        <Field label={t('bankName')}>
          <input
            required
            minLength={2}
            maxLength={80}
            value={form.bankName}
            onChange={(e) => set('bankName')(e.target.value)}
            className={field}
          />
        </Field>
      )}
      <Field label={t('chequeNumber')}>
        <input
          required
          maxLength={40}
          dir="ltr"
          value={form.chequeNumber}
          onChange={(e) => set('chequeNumber')(e.target.value)}
          className={field}
        />
      </Field>
      {purpose !== 'payout' && (
        <Field label={purpose === 'bill' ? t('settles') : t('amount')}>
          <input
            required
            inputMode="decimal"
            dir="ltr"
            value={form.amount}
            onChange={(e) => set('amount')(e.target.value)}
            className={field}
          />
        </Field>
      )}
      <Field label={t('party')}>
        <input
          maxLength={120}
          value={form.partyName}
          placeholder={purpose === 'other_income' ? '' : t('partyHint')}
          required={purpose === 'other_income'}
          onChange={(e) => set('partyName')(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('issueDate')}>
        <DateInput
          value={form.issueDate}
          onChange={(e) => set('issueDate')(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('dueDate')}>
        <DateInput
          value={form.dueDate}
          onChange={(e) => set('dueDate')(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('note')}>
        <input
          maxLength={300}
          value={form.note}
          onChange={(e) => set('note')(e.target.value)}
          className={field}
        />
      </Field>
      <div className="text-caption sm:col-span-2">
        <span className="mb-1 block">{t('photo')}</span>
        <AttachmentField onChange={setFiles} resetKey={round} />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className={primary}>
          {t('submit')}
        </button>
        <ActionMessage message={message} />
      </div>
    </form>
  );
}

/** What can be done to one cheque now. */
export function ChequeActions({
  cheque,
  banks,
}: {
  cheque: ChequeDetail;
  banks: { id: string; code: string; nameEn: string; nameAr: string }[];
}) {
  const t = useTranslations('finance.cheques');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const { busy, message, send } = useFinanceAction();
  const [mode, setMode] = useState<'deposit' | 'clear' | 'bounce' | 'cancel' | null>(null);
  const [bankId, setBankId] = useState(cheque.bankAccount?.id ?? banks[0]?.id ?? '');
  const [day, setDay] = useState('');
  const [text, setText] = useState('');
  const received = cheque.direction === 'received';
  const open = received
    ? cheque.status === 'received' || cheque.status === 'deposited'
    : cheque.status === 'issued';
  const canDeposit = received && cheque.status === 'received';
  const canCancel = ['awaiting_approval', 'received', 'issued'].includes(cheque.status);
  if (!open && !canCancel) return null;

  async function go() {
    const path = `/finance/cheques/${cheque.id}/${mode}`;
    const body =
      mode === 'deposit' || mode === 'clear'
        ? { ...(received && bankId ? { bankAccountId: bankId } : {}), ...(day ? { day } : {}) }
        : mode === 'bounce'
          ? { reason: text, ...(day ? { day } : {}) }
          : { note: text };
    const done = await send('POST', path, body);
    if (done) {
      setMode(null);
      setText('');
    }
  }

  return (
    <section className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4 print:hidden">
      <div className="flex flex-wrap gap-2">
        {canDeposit && (
          <button type="button" className={secondary} onClick={() => setMode('deposit')}>
            {t('deposit')}
          </button>
        )}
        {open && (
          <button type="button" className={primary} onClick={() => setMode('clear')}>
            {t('clear')}
          </button>
        )}
        {open && (
          <button type="button" className={danger} onClick={() => setMode('bounce')}>
            {t('bounce')}
          </button>
        )}
        {canCancel && (
          <button type="button" className={secondary} onClick={() => setMode('cancel')}>
            {t('cancel')}
          </button>
        )}
      </div>
      {mode && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(mode === 'deposit' || mode === 'clear') && received && (
            <Field label={t('ourBank')}>
              <select value={bankId} onChange={(e) => setBankId(e.target.value)} className={field}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} {locale === 'ar' ? b.nameAr : b.nameEn}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {mode !== 'cancel' && (
            <Field label={t('day')}>
              <DateInput value={day} onChange={(e) => setDay(e.target.value)} className={field} />
            </Field>
          )}
          {(mode === 'bounce' || mode === 'cancel') && (
            <Field label={mode === 'bounce' ? t('bounceReason') : t('cancelNote')}>
              <input
                required
                minLength={3}
                maxLength={300}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={field}
              />
            </Field>
          )}
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={
                busy || ((mode === 'bounce' || mode === 'cancel') && text.trim().length < 3)
              }
              className={mode === 'bounce' ? danger : primary}
              onClick={() => void go()}
            >
              {t(mode)}
            </button>
            <button type="button" className={secondary} onClick={() => setMode(null)}>
              {tf('cancel')}
            </button>
          </div>
        </div>
      )}
      <ActionMessage message={message} />
    </section>
  );
}

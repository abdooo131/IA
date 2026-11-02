'use client';

import { cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import {
  AGEING_BUCKETS,
  type BillAgeing,
  type BillRow,
  type BookAccount,
  type FixedAssetRow,
  type PrepaymentRow,
  type ReceivableRow,
  type RecurringRow,
  type StoreOption,
  type SupplierRow,
  type TaxesOwed,
  type WhtReport,
} from '@/lib/finance-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// Suppliers and bills, taxes, recurring expenses, prepayments and equipment, and merchants
// who owe us. Every form posts through useFinanceAction, so money going out above the
// approval limit shows "sent for approval" instead of posting.

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';
const thisMonth = () => cairoDay(new Date()).slice(0, 7);
const TAX_KINDS = [
  'wht',
  'vat',
  'payroll_tax',
  'social_insurance',
  'martyrs_fund',
  'corporate_tax',
] as const;
type TaxKind = (typeof TAX_KINDS)[number];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-caption">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-body-sm">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function useName() {
  const locale = useLocale();
  return (a: { code?: string; nameEn: string; nameAr: string } | null | undefined) =>
    a ? `${a.code ? `${a.code} ` : ''}${locale === 'ar' ? a.nameAr : a.nameEn}` : '';
}

function AccountSelect({
  accounts,
  value,
  onChange,
  label,
  empty,
}: {
  accounts: BookAccount[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  empty?: string;
}) {
  const name = useName();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={field}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {name(a)}
        </option>
      ))}
    </select>
  );
}

function StoreSelect({
  stores,
  value,
  onChange,
}: {
  stores: StoreOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations('finance.payables');
  const name = useName();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('store')}
      className={field}
    >
      <option value="">{t('companyWide')}</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {name(s)}
        </option>
      ))}
    </select>
  );
}

const egpInput = (value: string, onChange: (v: string) => void, label: string) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    inputMode="decimal"
    dir="ltr"
    aria-label={label}
    placeholder="0.00"
    className={`${field} text-end`}
  />
);

const percentToBp = (text: string) => {
  const v = text.trim() === '' ? 0 : Number(text);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 100) : null;
};

// ─── suppliers and bills ─────────────────────────────────────────────────────

function PayBill({ bill, money }: { bill: BillRow; money: BookAccount[] }) {
  const t = useTranslations('finance.payables');
  const action = useFinanceAction();
  const foreign = bill.currency !== 'EGP';
  const [amount, setAmount] = useState(
    ((foreign ? (bill.foreignLeftCents ?? 0) : bill.leftPiastres) / 100).toFixed(2),
  );
  const [rate, setRate] = useState(bill.fxRate ? String(bill.fxRate) : '');
  const [from, setFrom] = useState(money[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [recovery, setRecovery] = useState('');
  const recoveryValue = recovery.trim() ? parseEgp(recovery) : 0;
  const typed = parseEgp(amount);
  const rateOk = !foreign || /^\d{1,6}(\.\d{1,6})?$/.test(rate.trim());
  // What this payment settles of the bill, in EGP at the bill's own rate.
  const value = typed === null ? null : foreign ? Math.round(typed * (bill.fxRate ?? 0)) : typed;
  const wht =
    value && bill.whtBp
      ? Math.round((bill.netPiastres * bill.whtBp * value) / (10_000 * bill.totalPiastres))
      : 0;
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {egpInput(
          amount,
          setAmount,
          foreign ? t('amountIn', { currency: bill.currency }) : t('amount'),
        )}
        {foreign && (
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            aria-label={t('rateToday', { currency: bill.currency })}
            placeholder={t('rateToday', { currency: bill.currency })}
            className={field}
          />
        )}
        <AccountSelect accounts={money} value={from} onChange={setFrom} label={t('paidFrom')} />
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={t('reference')}
          aria-label={t('reference')}
          className={field}
        />
      </div>
      {bill.person && (
        <Field label={t('advanceBack', { name: bill.person.name })}>
          {egpInput(recovery, setRecovery, t('advanceBack', { name: bill.person.name }))}
        </Field>
      )}
      {(wht > 0 || (recoveryValue ?? 0) > 0) && (
        <p className="text-caption text-text-muted">
          {t('whtKept', {
            amount: formatEgp(wht),
            cash: formatEgp((value ?? 0) - wht - (recoveryValue ?? 0)),
          })}
        </p>
      )}
      <button
        type="button"
        className={primary}
        disabled={
          action.busy ||
          !value ||
          !from ||
          reference.trim().length < 2 ||
          recoveryValue === null ||
          !rateOk
        }
        onClick={() =>
          void action.send('POST', `/finance/bills/${bill.id}/payments`, {
            ...(foreign
              ? { foreignAmountCents: typed, fxRate: rate.trim() }
              : { amountPiastres: value }),
            moneyAccountId: from,
            reference,
            advanceRecoveryPiastres: recoveryValue || undefined,
            idempotencyKey: newActionKey(),
          })
        }
      >
        {t('pay')}
      </button>
      <ActionMessage message={action.message} />
    </div>
  );
}

function CancelBill({ bill }: { bill: BillRow }) {
  const t = useTranslations('finance.payables');
  const action = useFinanceAction();
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('cancelReason')}
        aria-label={t('cancelReason')}
        className={`${field} max-w-xs`}
      />
      <button
        type="button"
        className={secondary}
        disabled={action.busy || reason.trim().length < 5}
        onClick={() => void action.send('POST', `/finance/bills/${bill.id}/cancel`, { reason })}
      >
        {t('cancelBill')}
      </button>
      <ActionMessage message={action.message} />
    </div>
  );
}

function NewSupplier({ expenses }: { expenses: BookAccount[] }) {
  const t = useTranslations('finance.payables');
  const action = useFinanceAction();
  const blank = { name: '', taxId: '', phone: '', email: '', wht: '', expense: '' };
  const [s, setS] = useState(blank);
  const bp = percentToBp(s.wht);
  return (
    <Card title={t('newSupplier')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('supplierName')}>
          <input
            value={s.name}
            onChange={(e) => setS({ ...s, name: e.target.value })}
            className={field}
          />
        </Field>
        <Field label={t('taxId')}>
          <input
            value={s.taxId}
            onChange={(e) => setS({ ...s, taxId: e.target.value })}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label={t('phone')}>
          <input
            value={s.phone}
            onChange={(e) => setS({ ...s, phone: e.target.value })}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label={t('email')}>
          <input
            value={s.email}
            onChange={(e) => setS({ ...s, email: e.target.value })}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label={t('whtPercent')}>
          <input
            value={s.wht}
            onChange={(e) => setS({ ...s, wht: e.target.value })}
            inputMode="decimal"
            dir="ltr"
            placeholder="1"
            className={field}
          />
        </Field>
        <Field label={t('defaultExpense')}>
          <AccountSelect
            accounts={expenses}
            value={s.expense}
            onChange={(v) => setS({ ...s, expense: v })}
            label={t('defaultExpense')}
            empty={t('none')}
          />
        </Field>
      </div>
      <p className="text-caption text-text-muted">{t('whtHint')}</p>
      <button
        type="button"
        className={primary}
        disabled={action.busy || s.name.trim().length < 2 || bp === null}
        onClick={async () => {
          const ok = await action.send('POST', '/finance/suppliers', {
            name: s.name,
            taxId: s.taxId,
            phone: s.phone,
            email: s.email,
            whtBp: bp,
            defaultExpenseAccountId: s.expense || undefined,
          });
          if (ok) setS(blank);
        }}
      >
        {t('addSupplier')}
      </button>
      <ActionMessage message={action.message} />
    </Card>
  );
}

function NewBill({
  suppliers,
  expenses,
  stores,
}: {
  suppliers: SupplierRow[];
  expenses: BookAccount[];
  stores: StoreOption[];
}) {
  const t = useTranslations('finance.payables');
  const action = useFinanceAction();
  const today = cairoDay(new Date());
  const blank = {
    supplierId: '',
    reference: '',
    billDate: today,
    dueDate: today,
    expense: '',
    store: '',
    net: '',
    vat: '',
    memo: '',
    person: '',
    currency: 'EGP',
    rate: '',
  };
  const [b, setB] = useState(blank);
  const active = suppliers.filter((s) => s.isActive);
  const foreign = b.currency !== 'EGP';
  const rateOk = !foreign || /^\d{1,6}(\.\d{1,6})?$/.test(b.rate.trim());
  // In a foreign currency the amounts are typed in that currency (cents work the same way).
  const typedNet = parseEgp(b.net);
  const typedVat = b.vat.trim() ? parseEgp(b.vat) : 0;
  const rate = foreign && rateOk ? Number(b.rate) : 1;
  const net = typedNet === null ? null : foreign ? Math.round(typedNet * rate) : typedNet;
  const vat = typedVat === null ? null : foreign ? Math.round(typedVat * rate) : typedVat;
  const supplier = suppliers.find((s) => s.id === b.supplierId);
  return (
    <Card title={t('newBill')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('supplier')}>
          <select
            value={b.supplierId}
            onChange={(e) => setB({ ...b, supplierId: e.target.value, person: '' })}
            className={field}
          >
            <option value="">{t('chooseSupplier')}</option>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('invoiceNumber')}>
          <input
            value={b.reference}
            onChange={(e) => setB({ ...b, reference: e.target.value })}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label={t('billDate')}>
          <DateInput
            value={b.billDate}
            max={today}
            onChange={(e) => setB({ ...b, billDate: e.target.value })}
          />
        </Field>
        <Field label={t('dueDate')}>
          <DateInput value={b.dueDate} onChange={(e) => setB({ ...b, dueDate: e.target.value })} />
        </Field>
        <Field label={t('expense')}>
          <AccountSelect
            accounts={expenses}
            value={b.expense}
            onChange={(v) => setB({ ...b, expense: v })}
            label={t('expense')}
            empty={supplier?.defaultExpenseAccountId ? t('supplierDefault') : t('chooseExpense')}
          />
        </Field>
        <Field label={t('store')}>
          <StoreSelect stores={stores} value={b.store} onChange={(v) => setB({ ...b, store: v })} />
        </Field>
        {supplier && supplier.staff.length > 0 && (
          <Field label={t('billPerson')}>
            <select
              value={b.person}
              onChange={(e) => setB({ ...b, person: e.target.value })}
              className={field}
            >
              <option value="">{t('nobody')}</option>
              {supplier.staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('currency')}>
          <select
            value={b.currency}
            onChange={(e) => setB({ ...b, currency: e.target.value })}
            className={field}
          >
            {['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        {foreign && (
          <Field label={t('rateOnBill', { currency: b.currency })}>
            <input
              value={b.rate}
              onChange={(e) => setB({ ...b, rate: e.target.value })}
              inputMode="decimal"
              dir="ltr"
              placeholder="48.50"
              className={field}
            />
          </Field>
        )}
        <Field label={foreign ? t('netIn', { currency: b.currency }) : t('net')}>
          {egpInput(b.net, (v) => setB({ ...b, net: v }), t('net'))}
        </Field>
        <Field label={foreign ? t('vatIn', { currency: b.currency }) : t('vat')}>
          {egpInput(b.vat, (v) => setB({ ...b, vat: v }), t('vat'))}
        </Field>
      </div>
      <Field label={t('memo')}>
        <input
          value={b.memo}
          onChange={(e) => setB({ ...b, memo: e.target.value })}
          className={field}
        />
      </Field>
      {net && vat !== null && rateOk && (
        <p className="text-body-sm font-bold">{t('billTotal', { amount: formatEgp(net + vat) })}</p>
      )}
      <button
        type="button"
        className={primary}
        disabled={
          action.busy ||
          !b.supplierId ||
          b.reference.trim().length < 2 ||
          !net ||
          vat === null ||
          !rateOk ||
          (!b.expense && !supplier?.defaultExpenseAccountId)
        }
        onClick={async () => {
          const ok = await action.send<{ number: string }>(
            'POST',
            '/finance/bills',
            {
              supplierId: b.supplierId,
              reference: b.reference,
              billDate: b.billDate,
              dueDate: b.dueDate,
              expenseAccountId: b.expense || undefined,
              darkStoreId: b.store || undefined,
              ...(foreign
                ? {
                    currency: b.currency,
                    foreignNetCents: typedNet,
                    foreignVatCents: typedVat,
                    fxRate: b.rate.trim(),
                  }
                : { netPiastres: net, vatPiastres: vat }),
              memo: b.memo,
              userId: b.person || undefined,
              idempotencyKey: newActionKey(),
            },
            (d) => t('billSaved', { number: d.number }),
          );
          // The next person on the same invoice: keep the supplier, number and dates.
          if (ok) setB(b.person ? { ...b, person: '', net: '', vat: '', memo: '' } : blank);
        }}
      >
        {t('saveBill')}
      </button>
      <ActionMessage message={action.message} />
    </Card>
  );
}

function AgeingTable({ ageing }: { ageing: BillAgeing }) {
  const t = useTranslations('finance.payables');
  if (ageing.rows.length === 0)
    return <p className="text-body-sm text-text-muted">{t('noneOwed')}</p>;
  return (
    <Table
      head={
        <>
          <th className={th}>{t('supplier')}</th>
          {AGEING_BUCKETS.map((b) => (
            <th key={b} className={`${th} text-end`}>
              {t(`buckets.${b}`)}
            </th>
          ))}
          <th className={`${th} text-end`}>{t('total')}</th>
        </>
      }
    >
      {ageing.rows.map((r) => (
        <tr key={r.supplier.id} className="border-t border-line">
          <td className={td}>{r.supplier.name}</td>
          {AGEING_BUCKETS.map((b) => (
            <td
              key={b}
              className={`${td} text-end ${b !== 'current' && r.buckets[b] ? 'text-danger' : ''}`}
            >
              <Amount piastres={r.buckets[b]} />
            </td>
          ))}
          <td className={`${td} text-end`}>
            <Amount piastres={r.total} strong />
          </td>
        </tr>
      ))}
      <tr className="border-t border-line font-bold">
        <td className={td}>{t('total')}</td>
        {AGEING_BUCKETS.map((b) => (
          <td key={b} className={`${td} text-end`}>
            <Amount piastres={ageing.total.buckets[b]} />
          </td>
        ))}
        <td className={`${td} text-end`}>
          <Amount piastres={ageing.total.total} strong />
        </td>
      </tr>
    </Table>
  );
}

export function SuppliersAndBills({
  suppliers,
  bills,
  ageing,
  accounts,
  stores,
}: {
  suppliers: SupplierRow[];
  bills: BillRow[];
  ageing: BillAgeing;
  accounts: BookAccount[];
  stores: StoreOption[];
}) {
  const t = useTranslations('finance.payables');
  const name = useName();
  const [open, setOpen] = useState<string | null>(null);
  const money = accounts.filter((a) => a.money && a.isActive);
  const expenses = accounts.filter((a) => [5400, 5500].includes(a.groupCode) && a.isActive);
  return (
    <div className="mt-4 space-y-8">
      <section className="space-y-2">
        <h2 className="text-h3">{t('ageing')}</h2>
        <AgeingTable ageing={ageing} />
      </section>

      <section className="space-y-2">
        <h2 className="text-h3">{t('openBills')}</h2>
        {bills.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noBills')}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('bill')}</th>
                <th className={th}>{t('supplier')}</th>
                <th className={th}>{t('dueDate')}</th>
                <th className={th}>{t('expense')}</th>
                <th className={`${th} text-end`}>{t('total')}</th>
                <th className={`${th} text-end`}>{t('left')}</th>
                <th className={th} />
              </>
            }
          >
            {bills.map((b) => (
              <FragmentRow
                key={b.id}
                colSpan={7}
                open={open === b.id}
                detail={
                  <div className="space-y-4">
                    <PayBill bill={b} money={money} />
                    {b.paidPiastres === 0 && <CancelBill bill={b} />}
                  </div>
                }
              >
                <td className={td}>
                  <span className="ltr-iso font-bold">{b.numberLabel}</span>
                  <span className="block text-caption text-text-muted">{b.reference}</span>
                </td>
                <td className={td}>
                  {b.supplier.name}
                  {b.person && (
                    <span className="block text-caption text-text-muted">{b.person.name}</span>
                  )}
                </td>
                <td className={`${td} ltr-iso ${b.overdue ? 'font-bold text-danger' : ''}`}>
                  {b.dueDate}
                </td>
                <td className={td}>
                  {name(b.expenseAccount)}
                  {b.darkStore && (
                    <span className="block text-caption text-text-muted">{name(b.darkStore)}</span>
                  )}
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={b.totalPiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={b.leftPiastres} strong />
                  {b.currency !== 'EGP' && b.foreignLeftCents !== null && (
                    <span className="block text-caption text-text-muted ltr-iso">
                      {b.currency} {(b.foreignLeftCents / 100).toFixed(2)}
                    </span>
                  )}
                </td>
                <td className={`${td} text-end`}>
                  <button
                    type="button"
                    className={secondary}
                    onClick={() => setOpen(open === b.id ? null : b.id)}
                  >
                    {open === b.id ? t('close') : t('payOrCancel')}
                  </button>
                </td>
              </FragmentRow>
            ))}
          </Table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <NewBill suppliers={suppliers} expenses={expenses} stores={stores} />
        <NewSupplier expenses={expenses} />
      </div>

      <section className="space-y-2">
        <h2 className="text-h3">{t('suppliers')}</h2>
        {suppliers.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noSuppliers')}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('supplierName')}</th>
                <th className={th}>{t('taxId')}</th>
                <th className={`${th} text-end`}>{t('whtPercent')}</th>
                <th className={`${th} text-end`}>{t('openBillsCount')}</th>
                <th className={`${th} text-end`}>{t('owed')}</th>
              </>
            }
          >
            {suppliers.map((s) => (
              <tr key={s.id} className={`border-t border-line ${s.isActive ? '' : 'opacity-60'}`}>
                <td className={td}>
                  {s.name}
                  {s.accountCode && (
                    <span className="ms-2 ltr-iso text-caption text-text-muted">
                      {s.accountCode}
                    </span>
                  )}
                </td>
                <td className={`${td} ltr-iso`}>
                  {s.taxId ?? <span className="text-danger">{t('noTaxId')}</span>}
                </td>
                <td className={`${td} text-end ltr-iso`}>{(s.whtBp / 100).toFixed(2)}%</td>
                <td className={`${td} text-end`}>{s.openBills}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={s.owedPiastres} strong />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

/** A table row with an optional detail row underneath it. */
function FragmentRow({
  children,
  detail,
  open,
  colSpan,
}: {
  children: ReactNode;
  detail: ReactNode;
  open: boolean;
  colSpan: number;
}) {
  return (
    <>
      <tr className="border-t border-line">{children}</tr>
      {open && (
        <tr className="bg-surface-raised">
          <td colSpan={colSpan} className="px-3 py-3">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── taxes ───────────────────────────────────────────────────────────────────

export function Taxes({
  owed,
  report,
  accounts,
}: {
  owed: TaxesOwed;
  report: WhtReport;
  accounts: BookAccount[];
}) {
  const t = useTranslations('finance.payables');
  const action = useFinanceAction();
  const money = accounts.filter((a) => a.money && a.isActive);
  const [tax, setTax] = useState<TaxKind>('wht');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(money[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const value = parseEgp(amount);
  const quarters = [1, 2, 3, 4];
  return (
    <div className="mt-4 space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['payroll_tax', owed.payrollTaxPiastres],
            ['social_insurance', owed.socialInsurancePiastres],
            ['martyrs_fund', owed.martyrsFundPiastres],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-label uppercase text-text-muted">{t(`taxNames.${k}`)}</p>
            <p className="mt-1 text-h2">
              <Amount piastres={v} />
            </p>
            <p className="text-caption text-text-muted">{t(`taxHints.${k}`)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-label uppercase text-text-muted">{t('vatOwed')}</p>
          <p className="mt-1 text-h2">
            <Amount piastres={owed.vatPiastres} />
          </p>
          <p className="text-caption text-text-muted">{t('vatOwedHint')}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-label uppercase text-text-muted">{t('whtOwed')}</p>
          <p className="mt-1 text-h2">
            <Amount piastres={owed.whtPiastres} />
          </p>
          <p className="text-caption text-text-muted">{t('whtOwedHint')}</p>
        </div>
      </div>

      <Card title={t('payTax')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('tax')}>
            <select
              value={tax}
              onChange={(e) => setTax(e.target.value as TaxKind)}
              className={field}
            >
              {TAX_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`taxNames.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('amount')}>{egpInput(amount, setAmount, t('amount'))}</Field>
          <Field label={t('paidFrom')}>
            <AccountSelect accounts={money} value={from} onChange={setFrom} label={t('paidFrom')} />
          </Field>
          <Field label={t('reference')}>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={field}
            />
          </Field>
        </div>
        <button
          type="button"
          className={primary}
          disabled={action.busy || !value || !from || reference.trim().length < 2}
          onClick={async () => {
            const ok = await action.send('POST', '/finance/taxes/payments', {
              tax,
              amountPiastres: value,
              moneyAccountId: from,
              reference,
              idempotencyKey: newActionKey(),
            });
            if (ok) {
              setAmount('');
              setReference('');
            }
          }}
        >
          {t('payTax')}
        </button>
        <ActionMessage message={action.message} />
      </Card>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-h3">
            {t('whtReport', { quarter: report.quarter, year: report.year })}
          </h2>
          <nav className="flex flex-wrap gap-2">
            {quarters.map((q) => (
              <a
                key={q}
                href={`?year=${report.year}&quarter=${q}`}
                className={`rounded-md border px-3 py-1 text-body-sm ${q === report.quarter ? 'border-primary font-bold' : 'border-line'}`}
              >
                Q{q}
              </a>
            ))}
            <a
              href={`?year=${report.year - 1}&quarter=${report.quarter}`}
              className="rounded-md border border-line px-3 py-1 text-body-sm"
            >
              {report.year - 1}
            </a>
          </nav>
        </div>
        <p className="text-caption text-text-muted">
          {t('whtReportHint', { from: report.from, to: report.to })}
        </p>
        {report.missingTaxId > 0 && (
          <p className="text-body-sm text-danger">
            {t('missingTaxIds', { count: report.missingTaxId })}
          </p>
        )}
        {report.rows.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noWht')}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('supplierName')}</th>
                <th className={th}>{t('taxId')}</th>
                <th className={`${th} text-end`}>{t('payments')}</th>
                <th className={`${th} text-end`}>{t('paidBeforeVat')}</th>
                <th className={`${th} text-end`}>{t('withheld')}</th>
              </>
            }
          >
            {report.rows.map((r) => (
              <tr key={r.supplierId} className="border-t border-line">
                <td className={td}>{r.name}</td>
                <td className={`${td} ltr-iso`}>
                  {r.taxId ?? <span className="text-danger">{t('noTaxId')}</span>}
                </td>
                <td className={`${td} text-end`}>{r.payments}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={r.netPiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={r.whtPiastres} strong />
                </td>
              </tr>
            ))}
            <tr className="border-t border-line font-bold">
              <td className={td} colSpan={4}>
                {t('total')}
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={report.totalWhtPiastres} strong />
              </td>
            </tr>
          </Table>
        )}
      </section>
    </div>
  );
}

// ─── recurring expenses ──────────────────────────────────────────────────────

export function Recurring({
  rows,
  accounts,
  stores,
}: {
  rows: RecurringRow[];
  accounts: BookAccount[];
  stores: StoreOption[];
}) {
  const t = useTranslations('finance.payables');
  const name = useName();
  const action = useFinanceAction();
  const toggle = useFinanceAction();
  const money = accounts.filter((a) => a.money && a.isActive);
  const expenses = accounts.filter((a) => [5400, 5500].includes(a.groupCode) && a.isActive);
  const blank = {
    name: '',
    expense: expenses[0]?.id ?? '',
    from: money[0]?.id ?? '',
    amount: '',
    vat: '',
    store: '',
    memo: '',
    reference: '',
    day: '1',
    start: thisMonth(),
    end: '',
  };
  const [r, setR] = useState(blank);
  const amount = parseEgp(r.amount);
  const vat = r.vat.trim() ? parseEgp(r.vat) : 0;
  const day = Number(r.day);
  return (
    <div className="mt-4 space-y-8">
      {rows.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('noRecurring')}</p>
      ) : (
        <Table
          head={
            <>
              <th className={th}>{t('recurringName')}</th>
              <th className={th}>{t('expense')}</th>
              <th className={`${th} text-end`}>{t('amount')}</th>
              <th className={th}>{t('everyMonthOn')}</th>
              <th className={th}>{t('thisMonth')}</th>
              <th className={th} />
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.id} className={`border-t border-line ${row.isActive ? '' : 'opacity-60'}`}>
              <td className={td}>
                {row.name}
                <span className="block text-caption text-text-muted">
                  {t('fromTo', { from: row.startMonth, to: row.endMonth ?? t('noEnd') })}
                </span>
              </td>
              <td className={td}>
                {name(row.expenseAccount)}
                <span className="block text-caption text-text-muted">{name(row.paidFrom)}</span>
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={row.amountPiastres} />
              </td>
              <td className={td}>{t('dayN', { day: row.dayOfMonth })}</td>
              <td className={td}>
                {row.preparedThisMonth
                  ? t('prepared')
                  : row.isActive
                    ? t('waitingDay')
                    : t('stopped')}
              </td>
              <td className={`${td} text-end`}>
                <button
                  type="button"
                  className={secondary}
                  disabled={toggle.busy}
                  onClick={() =>
                    void toggle.send('PATCH', `/finance/recurring/${row.id}`, {
                      isActive: !row.isActive,
                    })
                  }
                >
                  {row.isActive ? t('stop') : t('restart')}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ActionMessage message={toggle.message} />

      <Card title={t('newRecurring')}>
        <p className="text-caption text-text-muted">{t('recurringHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('recurringName')}>
            <input
              value={r.name}
              onChange={(e) => setR({ ...r, name: e.target.value })}
              className={field}
            />
          </Field>
          <Field label={t('expense')}>
            <AccountSelect
              accounts={expenses}
              value={r.expense}
              onChange={(v) => setR({ ...r, expense: v })}
              label={t('expense')}
            />
          </Field>
          <Field label={t('paidFrom')}>
            <AccountSelect
              accounts={money}
              value={r.from}
              onChange={(v) => setR({ ...r, from: v })}
              label={t('paidFrom')}
            />
          </Field>
          <Field label={t('store')}>
            <StoreSelect
              stores={stores}
              value={r.store}
              onChange={(v) => setR({ ...r, store: v })}
            />
          </Field>
          <Field label={t('amountWithVat')}>
            {egpInput(r.amount, (v) => setR({ ...r, amount: v }), t('amountWithVat'))}
          </Field>
          <Field label={t('vatPart')}>
            {egpInput(r.vat, (v) => setR({ ...r, vat: v }), t('vatPart'))}
          </Field>
          <Field label={t('memo')}>
            <input
              value={r.memo}
              onChange={(e) => setR({ ...r, memo: e.target.value })}
              className={field}
            />
          </Field>
          <Field label={t('reference')}>
            <input
              value={r.reference}
              onChange={(e) => setR({ ...r, reference: e.target.value })}
              className={field}
            />
          </Field>
          <Field label={t('dayOfMonth')}>
            <input
              value={r.day}
              onChange={(e) => setR({ ...r, day: e.target.value })}
              inputMode="numeric"
              dir="ltr"
              className={field}
            />
          </Field>
          <Field label={t('startMonth')}>
            <input
              type="month"
              value={r.start}
              onChange={(e) => setR({ ...r, start: e.target.value })}
              dir="ltr"
              className={field}
            />
          </Field>
          <Field label={t('endMonth')}>
            <input
              type="month"
              value={r.end}
              onChange={(e) => setR({ ...r, end: e.target.value })}
              dir="ltr"
              className={field}
            />
          </Field>
        </div>
        <button
          type="button"
          className={primary}
          disabled={
            action.busy ||
            r.name.trim().length < 2 ||
            !amount ||
            vat === null ||
            !Number.isInteger(day) ||
            day < 1 ||
            day > 28 ||
            r.memo.trim().length < 3 ||
            r.reference.trim().length < 2
          }
          onClick={async () => {
            const ok = await action.send('POST', '/finance/recurring', {
              name: r.name,
              expenseAccountId: r.expense,
              paidFromAccountId: r.from,
              amountPiastres: amount,
              vatPiastres: vat,
              darkStoreId: r.store || undefined,
              memo: r.memo,
              reference: r.reference,
              dayOfMonth: day,
              startMonth: r.start,
              endMonth: r.end || undefined,
            });
            if (ok) setR(blank);
          }}
        >
          {t('saveRecurring')}
        </button>
        <ActionMessage message={action.message} />
      </Card>
    </div>
  );
}

// ─── prepayments and equipment ───────────────────────────────────────────────

export function PrepaidAndAssets({
  prepayments,
  assets,
  accounts,
  stores,
}: {
  prepayments: PrepaymentRow[];
  assets: FixedAssetRow[];
  accounts: BookAccount[];
  stores: StoreOption[];
}) {
  const t = useTranslations('finance.payables');
  const name = useName();
  const pre = useFinanceAction();
  const buy = useFinanceAction();
  const money = accounts.filter((a) => a.money && a.isActive);
  const expenses = accounts.filter((a) => [5400, 5500].includes(a.groupCode) && a.isActive);
  const blankP = {
    name: '',
    expense: expenses[0]?.id ?? '',
    amount: '',
    months: '12',
    start: thisMonth(),
    store: '',
    from: money[0]?.id ?? '',
    reference: '',
  };
  const blankA = {
    name: '',
    amount: '',
    salvage: '',
    months: '36',
    start: thisMonth(),
    store: '',
    from: money[0]?.id ?? '',
    reference: '',
  };
  const [p, setP] = useState(blankP);
  const [a, setA] = useState(blankA);
  const pAmount = parseEgp(p.amount);
  const aAmount = parseEgp(a.amount);
  const salvage = a.salvage.trim() ? parseEgp(a.salvage) : 0;
  const pMonths = Number(p.months);
  const aMonths = Number(a.months);
  const monthInput = (value: string, onChange: (v: string) => void) => (
    <input
      type="month"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      dir="ltr"
      className={field}
    />
  );
  return (
    <div className="mt-4 space-y-8">
      <section className="space-y-2">
        <h2 className="text-h3">{t('prepaid')}</h2>
        {prepayments.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noPrepaid')}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('item')}</th>
                <th className={`${th} text-end`}>{t('paid')}</th>
                <th className={`${th} text-end`}>{t('perMonth')}</th>
                <th className={th}>{t('progress')}</th>
                <th className={`${th} text-end`}>{t('leftAhead')}</th>
              </>
            }
          >
            {prepayments.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className={td}>
                  {row.name}
                  <span className="block text-caption text-text-muted">
                    {name(row.expenseAccount)}
                    {row.darkStore ? ` · ${name(row.darkStore)}` : ''}
                  </span>
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={row.totalPiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={row.monthlyPiastres} />
                </td>
                <td className={td}>
                  {t('monthsOf', {
                    done: row.monthsCharged,
                    of: row.months,
                    start: row.startMonth,
                  })}
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={row.leftPiastres} strong />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-h3">{t('equipment')}</h2>
        {assets.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noAssets')}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('item')}</th>
                <th className={`${th} text-end`}>{t('cost')}</th>
                <th className={`${th} text-end`}>{t('perMonth')}</th>
                <th className={th}>{t('progress')}</th>
                <th className={`${th} text-end`}>{t('bookValue')}</th>
              </>
            }
          >
            {assets.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className={td}>
                  {row.name}
                  {row.darkStore && (
                    <span className="block text-caption text-text-muted">
                      {name(row.darkStore)}
                    </span>
                  )}
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={row.costPiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={row.monthlyPiastres} />
                </td>
                <td className={td}>
                  {t('monthsOf', {
                    done: row.monthsCharged,
                    of: row.lifeMonths,
                    start: row.startMonth,
                  })}
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={row.bookValuePiastres} strong />
                  <span className="block">
                    <DisposeAsset asset={row} money={money} />
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('newPrepaid')}>
          <p className="text-caption text-text-muted">{t('prepaidHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('item')}>
              <input
                value={p.name}
                onChange={(e) => setP({ ...p, name: e.target.value })}
                className={field}
              />
            </Field>
            <Field label={t('expense')}>
              <AccountSelect
                accounts={expenses}
                value={p.expense}
                onChange={(v) => setP({ ...p, expense: v })}
                label={t('expense')}
              />
            </Field>
            <Field label={t('amount')}>
              {egpInput(p.amount, (v) => setP({ ...p, amount: v }), t('amount'))}
            </Field>
            <Field label={t('months')}>
              <input
                value={p.months}
                onChange={(e) => setP({ ...p, months: e.target.value })}
                inputMode="numeric"
                dir="ltr"
                className={field}
              />
            </Field>
            <Field label={t('startMonth')}>
              {monthInput(p.start, (v) => setP({ ...p, start: v }))}
            </Field>
            <Field label={t('store')}>
              <StoreSelect
                stores={stores}
                value={p.store}
                onChange={(v) => setP({ ...p, store: v })}
              />
            </Field>
            <Field label={t('paidFrom')}>
              <AccountSelect
                accounts={money}
                value={p.from}
                onChange={(v) => setP({ ...p, from: v })}
                label={t('paidFrom')}
              />
            </Field>
            <Field label={t('reference')}>
              <input
                value={p.reference}
                onChange={(e) => setP({ ...p, reference: e.target.value })}
                className={field}
              />
            </Field>
          </div>
          {pAmount && pMonths >= 1 && (
            <p className="text-body-sm">
              {t('eachMonth', { amount: formatEgp(Math.floor(pAmount / pMonths)) })}
            </p>
          )}
          <button
            type="button"
            className={primary}
            disabled={
              pre.busy ||
              p.name.trim().length < 2 ||
              !pAmount ||
              !Number.isInteger(pMonths) ||
              pMonths < 1 ||
              pMonths > 120 ||
              p.reference.trim().length < 2
            }
            onClick={async () => {
              const ok = await pre.send('POST', '/finance/prepayments', {
                name: p.name,
                expenseAccountId: p.expense,
                amountPiastres: pAmount,
                months: pMonths,
                startMonth: p.start,
                darkStoreId: p.store || undefined,
                moneyAccountId: p.from,
                reference: p.reference,
                idempotencyKey: newActionKey(),
              });
              if (ok) setP(blankP);
            }}
          >
            {t('savePrepaid')}
          </button>
          <ActionMessage message={pre.message} />
        </Card>

        <Card title={t('newAsset')}>
          <p className="text-caption text-text-muted">{t('assetHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('item')}>
              <input
                value={a.name}
                onChange={(e) => setA({ ...a, name: e.target.value })}
                className={field}
              />
            </Field>
            <Field label={t('cost')}>
              {egpInput(a.amount, (v) => setA({ ...a, amount: v }), t('cost'))}
            </Field>
            <Field label={t('salvage')}>
              {egpInput(a.salvage, (v) => setA({ ...a, salvage: v }), t('salvage'))}
            </Field>
            <Field label={t('lifeMonths')}>
              <input
                value={a.months}
                onChange={(e) => setA({ ...a, months: e.target.value })}
                inputMode="numeric"
                dir="ltr"
                className={field}
              />
            </Field>
            <Field label={t('startMonth')}>
              {monthInput(a.start, (v) => setA({ ...a, start: v }))}
            </Field>
            <Field label={t('store')}>
              <StoreSelect
                stores={stores}
                value={a.store}
                onChange={(v) => setA({ ...a, store: v })}
              />
            </Field>
            <Field label={t('paidFrom')}>
              <AccountSelect
                accounts={money}
                value={a.from}
                onChange={(v) => setA({ ...a, from: v })}
                label={t('paidFrom')}
              />
            </Field>
            <Field label={t('reference')}>
              <input
                value={a.reference}
                onChange={(e) => setA({ ...a, reference: e.target.value })}
                className={field}
              />
            </Field>
          </div>
          {aAmount && salvage !== null && aMonths >= 1 && salvage < aAmount && (
            <p className="text-body-sm">
              {t('eachMonthDepr', {
                amount: formatEgp(Math.floor((aAmount - salvage) / aMonths)),
              })}
            </p>
          )}
          <button
            type="button"
            className={primary}
            disabled={
              buy.busy ||
              a.name.trim().length < 2 ||
              !aAmount ||
              salvage === null ||
              salvage >= aAmount ||
              !Number.isInteger(aMonths) ||
              aMonths < 1 ||
              aMonths > 600 ||
              a.reference.trim().length < 2
            }
            onClick={async () => {
              const ok = await buy.send('POST', '/finance/assets', {
                name: a.name,
                amountPiastres: aAmount,
                salvagePiastres: salvage,
                lifeMonths: aMonths,
                startMonth: a.start,
                darkStoreId: a.store || undefined,
                moneyAccountId: a.from,
                reference: a.reference,
                idempotencyKey: newActionKey(),
              });
              if (ok) setA(blankA);
            }}
          >
            {t('saveAsset')}
          </button>
          <ActionMessage message={buy.message} />
        </Card>
      </div>
    </div>
  );
}

function DisposeAsset({ asset, money }: { asset: FixedAssetRow; money: BookAccount[] }) {
  const t = useTranslations('finance.payables');
  const action = useFinanceAction();
  const [open, setOpen] = useState(false);
  const [sale, setSale] = useState('');
  const [from, setFrom] = useState(money[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const saleValue = sale.trim() ? parseEgp(sale) : 0;
  if (asset.disposedAt)
    return <span className="text-caption text-text-muted">{t('disposed')}</span>;
  if (!open)
    return (
      <button type="button" className={secondary} onClick={() => setOpen(true)}>
        {t('sellOrScrap')}
      </button>
    );
  return (
    <div className="mt-2 space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {egpInput(sale, setSale, t('salePrice'))}
        {(saleValue ?? 0) > 0 && (
          <AccountSelect accounts={money} value={from} onChange={setFrom} label={t('paidFrom')} />
        )}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('disposeReason')}
          aria-label={t('disposeReason')}
          className={field}
        />
      </div>
      <p className="text-caption text-text-muted">{t('disposeHint')}</p>
      <button
        type="button"
        className={primary}
        disabled={action.busy || saleValue === null || reason.trim().length < 5}
        onClick={() =>
          void action.send('POST', `/finance/assets/${asset.id}/dispose`, {
            salePiastres: saleValue,
            moneyAccountId: (saleValue ?? 0) > 0 ? from : undefined,
            reason,
            idempotencyKey: newActionKey(),
          })
        }
      >
        {t('confirmDispose')}
      </button>
      <ActionMessage message={action.message} />
    </div>
  );
}

// ─── merchants who owe us ────────────────────────────────────────────────────

function AskToPay({ row }: { row: ReceivableRow }) {
  const t = useTranslations('finance.payables');
  const action = useFinanceAction();
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={secondary}
        disabled={action.busy}
        onClick={() =>
          void action.send('POST', `/finance/receivables/${row.merchantId}/request`, {}, () =>
            t('asked'),
          )
        }
      >
        {t('askToPay')}
      </button>
      <ActionMessage message={action.message} />
    </span>
  );
}

export function Receivables({ rows }: { rows: ReceivableRow[] }) {
  const t = useTranslations('finance.payables');
  const locale = useLocale();
  if (rows.length === 0)
    return <p className="mt-4 text-body-sm text-text-muted">{t('nobodyOwes')}</p>;
  return (
    <div className="mt-4">
      <Table
        head={
          <>
            <th className={th}>{t('merchant')}</th>
            <th className={th}>{t('since')}</th>
            <th className={th}>{t('lastAsked')}</th>
            <th className={`${th} text-end`}>{t('owesUs')}</th>
            <th className={th} />
          </>
        }
      >
        {rows.map((r) => (
          <tr key={r.merchantId} className="border-t border-line">
            <td className={td}>
              <a href={`/finance/merchants/${r.merchantId}`} className="font-bold underline">
                {r.name}
              </a>
              {r.phone && (
                <span className="block ltr-iso text-caption text-text-muted">{r.phone}</span>
              )}
            </td>
            <td className={td}>{r.since ? formatCairoDateTime(r.since, locale) : ''}</td>
            <td className={td}>
              {r.lastRequestedAt ? formatCairoDateTime(r.lastRequestedAt, locale) : t('never')}
            </td>
            <td className={`${td} text-end`}>
              <Amount piastres={r.owesPiastres} strong />
            </td>
            <td className={`${td} text-end`}>
              <AskToPay row={r} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

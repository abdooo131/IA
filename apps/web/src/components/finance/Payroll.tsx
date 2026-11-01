'use client';

import { addDays, cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { BookAccount, StaffPayRow, SupplierRow } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const egpText = (p: number | null) => (p === null ? '' : formatEgp(p).replace(/,/g, ''));

/** Salary and insured wage of one employee (admin edits, others read). */
function SalaryCell({ row, canEdit }: { row: StaffPayRow; canEdit: boolean }) {
  const t = useTranslations('finance.payroll');
  const action = useFinanceAction();
  const [salary, setSalary] = useState(egpText(row.monthlyPiastres));
  const [insured, setInsured] = useState(egpText(row.insuredWagePiastres));
  if (!canEdit)
    return row.monthlyPiastres === null ? (
      <span className="text-text-muted">{t('notSet')}</span>
    ) : (
      <span>
        <Amount piastres={row.monthlyPiastres} />
        {row.insuredWagePiastres !== null && (
          <span className="block text-caption text-text-muted">
            {t('insuredShort', { amount: formatEgp(row.insuredWagePiastres) })}
          </span>
        )}
      </span>
    );
  const value = parseEgp(salary);
  const insuredValue = insured.trim() ? parseEgp(insured) : null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        value={salary}
        onChange={(e) => setSalary(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        aria-label={t('salary')}
        placeholder={t('salary')}
        className={`${field} w-28 text-end`}
      />
      <input
        value={insured}
        onChange={(e) => setInsured(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        aria-label={t('insured')}
        placeholder={t('insured')}
        title={t('insuredHint')}
        className={`${field} w-28 text-end`}
      />
      <button
        type="button"
        disabled={action.busy || value === null || (insured.trim() !== '' && insuredValue === null)}
        onClick={() =>
          void action.send('PUT', `/finance/salaries/${row.userId}`, {
            monthlyPiastres: value,
            insuredWagePiastres: insuredValue,
          })
        }
        className={secondary}
      >
        {t('save')}
      </button>
      <ActionMessage message={action.message} />
    </span>
  );
}

/** Employee, or hired through an outsourcing company (admin decides). */
function EmploymentCell({
  row,
  agencies,
  canEdit,
}: {
  row: StaffPayRow;
  agencies: SupplierRow[];
  canEdit: boolean;
}) {
  const t = useTranslations('finance.payroll');
  const action = useFinanceAction();
  const [value, setValue] = useState(
    row.employment === 'outsourced' ? (row.staffingSupplier?.id ?? '') : '',
  );
  if (!canEdit)
    return (
      <span>
        {row.employment === 'outsourced'
          ? t('outsourcedVia', { company: row.staffingSupplier?.name ?? '' })
          : t('employee')}
      </span>
    );
  const current = row.employment === 'outsourced' ? (row.staffingSupplier?.id ?? '') : '';
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t('employment')}
        className={`${field} w-48`}
      >
        <option value="">{t('employee')}</option>
        {agencies.map((a) => (
          <option key={a.id} value={a.id}>
            {t('outsourcedVia', { company: a.name })}
          </option>
        ))}
      </select>
      {value !== current && (
        <button
          type="button"
          className={secondary}
          disabled={action.busy}
          onClick={() =>
            void action.send(
              'PUT',
              `/finance/employment/${row.userId}`,
              value
                ? { employment: 'outsourced', staffingSupplierId: value }
                : { employment: 'employee' },
            )
          }
        >
          {t('save')}
        </button>
      )}
      <ActionMessage message={action.message} />
    </span>
  );
}

interface PreviewRow {
  userId: string;
  name: string;
  gross: number;
  siEmployee: number;
  siEmployer: number;
  martyrs: number;
  incomeTax: number;
  recovery: number;
  net: number;
}
interface Preview {
  rows: PreviewRow[];
  totalNetPiastres: number;
  totalCostPiastres: number;
  totalIncomeTaxPiastres: number;
  totalSocialInsurancePiastres: number;
  totalMartyrsPiastres: number;
}

/** Salaries, advances, bonuses for outsourced people, and the monthly salary run. */
export function Payroll({
  staff,
  money,
  suppliers,
  isAdmin,
}: {
  staff: StaffPayRow[];
  money: BookAccount[];
  suppliers: SupplierRow[];
  isAdmin: boolean;
}) {
  const t = useTranslations('finance.payroll');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const action = useFinanceAction();
  const advance = useFinanceAction();
  const bonus = useFinanceAction();
  const lastMonth = addDays(`${cairoDay(new Date()).slice(0, 8)}01`, -1).slice(0, 7);
  const [month, setMonth] = useState(lastMonth);
  const [from, setFrom] = useState(money[0]?.id ?? '');
  const employees = staff.filter((s) => s.employment === 'employee');
  const outsourced = staff.filter((s) => s.employment === 'outsourced');
  const paid = employees.filter((s) => s.monthlyPiastres !== null);
  const [lines, setLines] = useState<
    Record<string, { bonus: string; deduction: string; recovery: string; include: boolean }>
  >(
    Object.fromEntries(
      paid.map((s) => [s.userId, { bonus: '', deduction: '', recovery: '', include: true }]),
    ),
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const blank = { userId: '', amount: '', reference: '', from: money[0]?.id ?? '' };
  const [adv, setAdv] = useState(blank);
  const [bon, setBon] = useState(blank);
  const set = (id: string, patch: Partial<(typeof lines)[string]>) => {
    setPreview(null);
    setLines({ ...lines, [id]: { ...lines[id]!, ...patch } });
  };
  const chosen = paid.filter((s) => lines[s.userId]?.include);
  const amount = (text: string | undefined) => parseEgp(text || '0') ?? 0;
  const body = {
    month,
    moneyAccountId: from,
    lines: chosen.map((s) => ({
      userId: s.userId,
      bonusPiastres: amount(lines[s.userId]!.bonus),
      deductionPiastres: amount(lines[s.userId]!.deduction),
      advanceRecoveryPiastres: amount(lines[s.userId]!.recovery),
    })),
  };
  const name = (s: StaffPayRow) =>
    `${s.name}${s.darkStore ? ` · ${locale === 'ar' ? s.darkStore.nameAr : s.darkStore.nameEn}` : ''}`;
  const moneySelect = (value: string, onChange: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('paidFrom')}
      className={field}
    >
      {money.map((m) => (
        <option key={m.id} value={m.id}>
          {m.code} {locale === 'ar' ? m.nameAr : m.nameEn}
        </option>
      ))}
    </select>
  );
  const moneyForm = (
    title: string,
    people: StaffPayRow[],
    state: typeof blank,
    setState: (v: typeof blank) => void,
    act: ReturnType<typeof useFinanceAction>,
    path: string,
    hint?: string,
  ) => (
    <section className="max-w-xl space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{title}</h2>
      {hint && <p className="text-caption text-text-muted">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={state.userId}
          onChange={(e) => setState({ ...state, userId: e.target.value })}
          aria-label={t('person')}
          className={field}
        >
          <option value="">{t('person')}</option>
          {people.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          value={state.amount}
          onChange={(e) => setState({ ...state, amount: e.target.value })}
          inputMode="decimal"
          dir="ltr"
          placeholder={t('amount')}
          aria-label={t('amount')}
          className={field}
        />
        <input
          value={state.reference}
          onChange={(e) => setState({ ...state, reference: e.target.value })}
          placeholder={t('reference')}
          aria-label={t('reference')}
          className={field}
        />
        {moneySelect(state.from, (v) => setState({ ...state, from: v }))}
      </div>
      <button
        type="button"
        className={primary}
        disabled={
          act.busy || !state.userId || !parseEgp(state.amount) || state.reference.trim().length < 2
        }
        onClick={async () => {
          const ok = await act.send('POST', path, {
            userId: state.userId,
            amountPiastres: parseEgp(state.amount),
            moneyAccountId: state.from,
            reference: state.reference,
            idempotencyKey: newActionKey(),
          });
          if (ok) setState({ ...state, amount: '', reference: '' });
        }}
      >
        {title}
      </button>
      <ActionMessage message={act.message} />
    </section>
  );

  return (
    <div className="mt-4 space-y-8">
      <section>
        <h2 className="text-h3">{t('team')}</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('person')}</th>
                <th className={th}>{t('employment')}</th>
                <th className={th}>{t('salary')}</th>
                <th className={`${th} text-end`}>{t('advanceOwed')}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.userId} className="border-t border-line">
                  <td className="px-3 py-2">{name(s)}</td>
                  <td className="px-3 py-2">
                    <EmploymentCell row={s} agencies={suppliers} canEdit={isAdmin} />
                  </td>
                  <td className="px-3 py-2">
                    {s.employment === 'outsourced' ? (
                      <span className="text-caption text-text-muted">{t('paidByCompany')}</span>
                    ) : (
                      <SalaryCell row={s} canEdit={isAdmin} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Amount piastres={s.advanceOwedPiastres} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-caption text-text-muted">{t('outsourcedHint')}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {moneyForm(t('giveAdvance'), staff, adv, setAdv, advance, '/finance/advances')}
        {moneyForm(
          t('giveBonus'),
          outsourced,
          bon,
          setBon,
          bonus,
          '/finance/staff-bonuses',
          t('bonusHint'),
        )}
      </div>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('run')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-caption">
            {t('month')}
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPreview(null);
              }}
              dir="ltr"
              className={`${field} mt-1 block`}
            />
          </label>
          <label className="text-caption">
            {t('paidFrom')}
            <span className="mt-1 block">{moneySelect(from, setFrom)}</span>
          </label>
          <a
            href={`/finance/payroll/payslips?month=${month}`}
            className={`${secondary} inline-flex items-center`}
          >
            {t('payslips')}
          </a>
        </div>
        {paid.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noSalaries')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr>
                  <th className={th}>{t('person')}</th>
                  <th className={`${th} text-end`}>{t('salary')}</th>
                  <th className={th}>{t('bonus')}</th>
                  <th className={th}>{t('deduction')}</th>
                  <th className={th}>{t('recovery')}</th>
                </tr>
              </thead>
              <tbody>
                {paid.map((s) => (
                  <tr key={s.userId} className="border-t border-line">
                    <td className="px-3 py-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={lines[s.userId]?.include ?? false}
                          onChange={(e) => set(s.userId, { include: e.target.checked })}
                        />
                        {name(s)}
                      </label>
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Amount piastres={s.monthlyPiastres ?? 0} />
                    </td>
                    {(['bonus', 'deduction', 'recovery'] as const).map((k) => (
                      <td key={k} className="px-3 py-2">
                        <input
                          value={lines[s.userId]?.[k] ?? ''}
                          onChange={(e) => set(s.userId, { [k]: e.target.value })}
                          inputMode="decimal"
                          dir="ltr"
                          placeholder="0"
                          aria-label={t(k)}
                          className={`${field} w-24`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          type="button"
          className={secondary}
          disabled={chosen.length === 0 || !from}
          onClick={async () => {
            setPreviewError('');
            const result = await apiSend<Preview>('POST', '/finance/payroll/preview', body);
            if (result.ok) setPreview(result.data);
            else
              setPreviewError(
                tf(
                  tf.has(`merchants.errors.${result.error}`)
                    ? `merchants.errors.${result.error}`
                    : 'merchants.errors.generic',
                ),
              );
          }}
        >
          {t('check')}
        </button>
        {previewError && <p className="text-body-sm text-danger">{previewError}</p>}
        {preview && (
          <div className="space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr>
                    <th className={th}>{t('person')}</th>
                    <th className={`${th} text-end`}>{t('gross')}</th>
                    <th className={`${th} text-end`}>{t('insurance')}</th>
                    <th className={`${th} text-end`}>{t('incomeTax')}</th>
                    <th className={`${th} text-end`}>{t('martyrs')}</th>
                    <th className={`${th} text-end`}>{t('recovery')}</th>
                    <th className={`${th} text-end`}>{t('net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.userId} className="border-t border-line">
                      <td className="px-3 py-2">{r.name}</td>
                      {[r.gross, r.siEmployee, r.incomeTax, r.martyrs, r.recovery].map((v, i) => (
                        <td key={i} className="px-3 py-2 text-end">
                          <Amount piastres={v} />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-end">
                        <Amount piastres={r.net} strong />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-body-sm">
              {t('owedToState', {
                tax: formatEgp(preview.totalIncomeTaxPiastres),
                insurance: formatEgp(preview.totalSocialInsurancePiastres),
                martyrs: formatEgp(preview.totalMartyrsPiastres),
              })}
            </p>
            <p className="text-body font-bold">
              {t('netTotal', { amount: formatEgp(preview.totalNetPiastres) })} ·{' '}
              {t('costTotal', { amount: formatEgp(preview.totalCostPiastres) })}
            </p>
            <button
              type="button"
              className={primary}
              disabled={action.busy}
              onClick={() => void action.send('POST', '/finance/payroll', body)}
            >
              {t('pay', { month })}
            </button>
          </div>
        )}
        <ActionMessage message={action.message} />
      </section>
    </div>
  );
}

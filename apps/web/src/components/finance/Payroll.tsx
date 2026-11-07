'use client';

import { addDays, cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { BookAccount, StaffPayRow } from '@/lib/finance-types';
import { isoToDayFirst } from '@/lib/day-first';
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

/** The salary package HR keeps for one person (read only here: HR edits people). */
function PackageCell({ row, hrLink }: { row: StaffPayRow; hrLink: boolean }) {
  const t = useTranslations('finance.payroll');
  if (row.monthlyPiastres === null)
    return (
      <span className="text-text-muted">
        {t('notSet')}
        {hrLink && row.employeeId && (
          <a href={`/admin/hr/${row.employeeId}?tab=pay`} className="ms-2 font-bold text-link">
            {t('setInHr')}
          </a>
        )}
      </span>
    );
  return (
    <span>
      <Amount piastres={row.monthlyPiastres} strong />
      <span className="block text-caption text-text-muted">
        {t('basicAndAllowances', {
          basic: formatEgp(row.basicPiastres ?? 0),
          allowances: formatEgp(row.allowancesPiastres ?? 0),
        })}
        {row.packageFrom && <> · {t('packageFrom', { date: isoToDayFirst(row.packageFrom) })}</>}
        {row.insuredWagePiastres !== null && (
          <> · {t('insuredShort', { amount: formatEgp(row.insuredWagePiastres) })}</>
        )}
      </span>
    </span>
  );
}

interface PreviewRow {
  userId: string;
  name: string;
  /** Approved sales commission taken with this salary */
  commission: number;
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
/** Approved sales commission of an outsourced person, paid here as a direct bonus. */
export interface OutsourcedCommission {
  id: string;
  month: string;
  user: { id: string; name: string };
  amountPiastres: number;
}

export function Payroll({
  staff,
  money,
  hrLink,
  commissions = [],
}: {
  staff: StaffPayRow[];
  money: BookAccount[];
  /** The person may open HR files (to change a package there) */
  hrLink: boolean;
  /** Sales commission approved for outsourced people (docs/SALES.md 11) */
  commissions?: OutsourcedCommission[];
}) {
  const t = useTranslations('finance.payroll');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const action = useFinanceAction();
  const advance = useFinanceAction();
  const bonus = useFinanceAction();
  const commissionPay = useFinanceAction();
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
        <p className="mt-1 max-w-3xl rounded-md bg-surface-raised px-3 py-2 text-body-sm">
          {t('readsHr')}
        </p>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('person')}</th>
                <th className={th}>{t('employment')}</th>
                <th className={th}>{t('salaryPackage')}</th>
                <th className={`${th} text-end`}>{t('advanceOwed')}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.userId} className="border-t border-line">
                  <td className="px-3 py-2">
                    {hrLink && s.employeeId ? (
                      <a href={`/admin/hr/${s.employeeId}`} className="font-bold text-link">
                        {s.name}
                      </a>
                    ) : (
                      <span className="font-bold">{s.name}</span>
                    )}
                    <span className="block text-caption text-text-muted">
                      {[
                        s.position
                          ? locale === 'ar'
                            ? s.position.titleAr
                            : s.position.titleEn
                          : null,
                        s.grade ? (locale === 'ar' ? s.grade.nameAr : s.grade.nameEn) : null,
                        s.darkStore
                          ? locale === 'ar'
                            ? s.darkStore.nameAr
                            : s.darkStore.nameEn
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '–'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {s.employment === 'outsourced'
                      ? t('outsourcedVia', { company: s.staffingSupplier?.name ?? '' })
                      : t('employee')}
                  </td>
                  <td className="px-3 py-2">
                    {s.employment === 'outsourced' ? (
                      <span className="text-caption text-text-muted">{t('paidByCompany')}</span>
                    ) : (
                      <PackageCell row={s} hrLink={hrLink} />
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

      {commissions.length > 0 && (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('commissionsTitle')}</h2>
          <p className="text-caption text-text-muted">{t('commissionsHint')}</p>
          <ul className="space-y-2 text-body-sm">
            {commissions.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3">
                <span className="font-bold">{c.user.name}</span>
                <span className="ltr-iso">{c.month}</span>
                <Amount piastres={c.amountPiastres} strong />
                <button
                  type="button"
                  className={secondary}
                  disabled={commissionPay.busy || !bon.from}
                  onClick={() =>
                    void commissionPay.send('POST', '/finance/staff-bonuses', {
                      userId: c.user.id,
                      amountPiastres: c.amountPiastres,
                      commissionId: c.id,
                      moneyAccountId: bon.from,
                      reference: `Sales commission ${c.month}`,
                      idempotencyKey: `commission-pay-${c.id}`,
                    })
                  }
                >
                  {t('payCommission')}
                </button>
              </li>
            ))}
          </ul>
          <ActionMessage message={commissionPay.message} />
        </section>
      )}

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
                      <td className="px-3 py-2">
                        {r.name}
                        {r.commission > 0 && (
                          <span className="block text-caption text-text-muted">
                            {t('withCommission', { amount: formatEgp(r.commission) })}
                          </span>
                        )}
                      </td>
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

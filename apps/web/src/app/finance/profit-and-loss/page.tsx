import { addDays, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { Amount } from '@/components/finance/Amount';
import { ReportTable } from '@/components/finance/ReportTable';
import { apiGet } from '@/lib/api-server';
import type { CostCenterOption, ProfitAndLoss, ProfitByCostCenter } from '@/lib/finance-types';
import { DateInput } from '@/components/DateInput';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; company?: string; costCenter?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const from = q.from && DAY.test(q.from) ? q.from : `${today.slice(0, 8)}01`;
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const company = q.company === 'shiply_now' || q.company === 'shiply' ? q.company : '';
  const costCenter = q.costCenter ?? '';
  const scope = new URLSearchParams({ from, to });
  if (company) scope.set('company', company);
  if (costCenter) scope.set('costCenter', costCenter);
  const [pl, split, centers, t, tf, locale] = await Promise.all([
    apiGet<ProfitAndLoss>(`/finance/profit-and-loss?${scope}`),
    apiGet<ProfitByCostCenter>(
      `/finance/profit-and-loss/by-cost-center?${new URLSearchParams({ from, to })}`,
    ),
    apiGet<CostCenterOption[]>('/finance/cost-centers'),
    getTranslations('finance.reports'),
    getTranslations('finance'),
    getLocale(),
  ]);
  const centerName = (c: { nameEn: string | null; nameAr: string | null }) =>
    (locale === 'ar' ? c.nameAr : c.nameEn) ?? t('noCostCenter');
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('plTitle')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('plIntro')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {tf('from')}
          <DateInput name="from" defaultValue={from} dir="ltr" className={field} />
        </label>
        <label className="text-caption">
          {tf('to')}
          <DateInput
            name="to"
            defaultValue={to}
            max={addDays(today, 0)}
            dir="ltr"
            className={field}
          />
        </label>
        <label className="text-caption">
          {t('company')}
          <select name="company" defaultValue={company} className={field}>
            <option value="">{t('bothCompanies')}</option>
            <option value="shiply_now">{t('companyShiplyNow')}</option>
            <option value="shiply">{t('companyShiply')}</option>
          </select>
        </label>
        <label className="text-caption">
          {t('costCenter')}
          <select name="costCenter" defaultValue={costCenter} className={field}>
            <option value="">{t('allCostCenters')}</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {centerName(c)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {tf('apply')}
        </button>
      </form>
      <div className="mt-4 grid max-w-4xl gap-4">
        <ReportTable
          title={t('income')}
          lines={pl.income}
          totalLabel={t('totalIncome')}
          total={pl.totalIncomePiastres}
        />
        <ReportTable
          title={t('expenses')}
          lines={pl.expenses}
          totalLabel={t('totalExpenses')}
          total={pl.totalExpensesPiastres}
        />
        <p className="rounded-lg border border-line bg-surface p-4 text-h3">
          {pl.profitPiastres >= 0 ? t('profit') : t('loss')}:{' '}
          <Amount piastres={pl.profitPiastres} strong /> EGP
        </p>
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('byCostCenter')}</h2>
          <p className="mt-1 text-body-sm text-text-muted">{t('byCostCenterIntro')}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-start text-caption text-text-muted">
                  <th className="py-2 text-start">{t('costCenter')}</th>
                  <th className="py-2 text-end">{t('income')}</th>
                  <th className="py-2 text-end">{t('expenses')}</th>
                  <th className="py-2 text-end">{t('profit')}</th>
                </tr>
              </thead>
              <tbody>
                {split.companies.map((c) => (
                  <CompanyRows
                    key={c.company}
                    title={c.company === 'shiply' ? t('companyShiply') : t('companyShiplyNow')}
                    total={c}
                    rows={split.costCenters
                      .filter((r) => r.company === c.company)
                      .map((r) => ({
                        key: r.costCenterId ?? `none-${c.company}`,
                        label: r.code ? `${r.code} ${centerName(r)}` : t('noCostCenter'),
                        ...r,
                      }))}
                  />
                ))}
                <tr className="border-t-2 border-line-strong font-bold">
                  <td className="py-2">{t('group')}</td>
                  <td className="py-2 text-end">
                    <Amount piastres={split.group.incomePiastres} />
                  </td>
                  <td className="py-2 text-end">
                    <Amount piastres={split.group.expensesPiastres} />
                  </td>
                  <td className="py-2 text-end">
                    <Amount piastres={split.group.profitPiastres} strong />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

type Money = { incomePiastres: number; expensesPiastres: number; profitPiastres: number };

/** One company's cost centers, then its total. */
function CompanyRows({
  title,
  total,
  rows,
}: {
  title: string;
  total: Money;
  rows: (Money & { key: string; label: string })[];
}) {
  return (
    <>
      <tr className="border-t border-line">
        <td colSpan={4} className="pt-3 pb-1 font-bold">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.key}>
          <td className="py-1 ps-3">{r.label}</td>
          <td className="py-1 text-end">
            <Amount piastres={r.incomePiastres} />
          </td>
          <td className="py-1 text-end">
            <Amount piastres={r.expensesPiastres} />
          </td>
          <td className="py-1 text-end">
            <Amount piastres={r.profitPiastres} />
          </td>
        </tr>
      ))}
      <tr className="font-bold">
        <td className="py-1 ps-3">{title}</td>
        <td className="py-1 text-end">
          <Amount piastres={total.incomePiastres} />
        </td>
        <td className="py-1 text-end">
          <Amount piastres={total.expensesPiastres} />
        </td>
        <td className="py-1 text-end">
          <Amount piastres={total.profitPiastres} />
        </td>
      </tr>
    </>
  );
}

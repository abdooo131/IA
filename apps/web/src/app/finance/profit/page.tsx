import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { DateInput } from '@/components/DateInput';
import { Amount } from '@/components/finance/Amount';
import { apiGet } from '@/lib/api-server';
import type { CostPerOrderRow, ProfitRow } from '@/lib/finance-types';
import { FinanceTabs } from '@/components/finance/FinanceTabs';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DIMENSIONS = ['store', 'merchant', 'rider'] as const;
type Dimension = (typeof DIMENSIONS)[number];

/** Profit per store, merchant or rider, and what one delivered order costs per store. */
export default async function FinanceProfitPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const from = q.from && DAY.test(q.from) ? q.from : `${today.slice(0, 8)}01`;
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const by: Dimension = DIMENSIONS.find((d) => d === q.by) ?? 'store';
  const range = new URLSearchParams({ from, to });
  const [profit, costs, t, tf, locale] = await Promise.all([
    apiGet<{ rows: ProfitRow[]; total: Omit<ProfitRow, 'id' | 'name'> }>(
      `/finance/profit?by=${by}&${range}`,
    ),
    apiGet<{ deliveredOrders: number; companyCostsPiastres: number; rows: CostPerOrderRow[] }>(
      `/finance/cost-per-order?${range}`,
    ),
    getTranslations('finance.profit'),
    getTranslations('finance'),
    getLocale(),
  ]);
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2';
  const money = (v: number | null) => (v === null ? '–' : <Amount piastres={v} />);
  return (
    <>
      <FinanceTabs family="reports" />
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="by" value={by} />
        <label className="text-caption">
          {tf('from')}
          <DateInput name="from" defaultValue={from} className={field} />
        </label>
        <label className="text-caption">
          {tf('to')}
          <DateInput name="to" defaultValue={to} max={today} className={field} />
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {tf('apply')}
        </button>
      </form>
      <nav className="mt-4 flex flex-wrap gap-2">
        {DIMENSIONS.map((d) => (
          <Link
            key={d}
            href={`/finance/profit?by=${d}&${range}`}
            className={`rounded-md px-4 py-2 text-body-sm font-bold ${d === by ? 'bg-selected-bg text-link' : 'text-text-muted'}`}
          >
            {t(`by.${d}`)}
          </Link>
        ))}
      </nav>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t(`by.${by}`)}</th>
              <th className={`${th} text-end`}>{t('income')}</th>
              <th className={`${th} text-end`}>{t('costs')}</th>
              <th className={`${th} text-end`}>{t('profit')}</th>
            </tr>
          </thead>
          <tbody>
            {profit.rows.map((r) => (
              <tr key={r.id ?? 'company'} className="border-t border-line">
                <td className={td}>{r.name ?? t('companyWide')}</td>
                <td className={`${td} text-end`}>{money(r.incomePiastres)}</td>
                <td className={`${td} text-end`}>{money(r.costsPiastres)}</td>
                <td
                  className={`${td} text-end font-bold ${r.profitPiastres < 0 ? 'text-danger' : ''}`}
                >
                  {money(r.profitPiastres)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-line font-bold">
              <td className={td}>{t('total')}</td>
              <td className={`${td} text-end`}>{money(profit.total.incomePiastres)}</td>
              <td className={`${td} text-end`}>{money(profit.total.costsPiastres)}</td>
              <td className={`${td} text-end`}>{money(profit.total.profitPiastres)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-h3">{t('perOrderTitle')}</h2>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">
        {t('perOrderIntro', { orders: costs.deliveredOrders })}
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('by.store')}</th>
              <th className={`${th} text-end`}>{t('orders')}</th>
              <th className={`${th} text-end`}>{t('incomePerOrder')}</th>
              <th className={`${th} text-end`}>{t('directPerOrder')}</th>
              <th className={`${th} text-end`}>{t('fullPerOrder')}</th>
              <th className={`${th} text-end`}>{t('profitPerOrder')}</th>
            </tr>
          </thead>
          <tbody>
            {costs.rows.map((r) => (
              <tr key={r.store.id} className="border-t border-line">
                <td className={td}>{locale === 'ar' ? r.store.nameAr : r.store.nameEn}</td>
                <td className={`${td} text-end`}>{r.deliveredOrders}</td>
                <td className={`${td} text-end`}>{money(r.incomePerOrderPiastres)}</td>
                <td className={`${td} text-end`}>{money(r.directCostPerOrderPiastres)}</td>
                <td className={`${td} text-end`}>{money(r.fullCostPerOrderPiastres)}</td>
                <td className={`${td} text-end font-bold`}>{money(r.profitPerOrderPiastres)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-caption text-text-muted">{t('perOrderHint')}</p>
    </>
  );
}

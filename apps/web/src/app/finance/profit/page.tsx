import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { ReportFilterBar } from '@/components/finance/reports/ReportFilterBar';
import { apiGet } from '@/lib/api-server';
import type { CostPerOrderRow, ProfitRow } from '@/lib/finance-types';
import { readReportState } from '@/lib/report-view';

export const dynamic = 'force-dynamic';
const DIMENSIONS = ['store', 'merchant', 'rider'] as const;
type Dimension = (typeof DIMENSIONS)[number];

/** Profit per store, merchant or rider, and what one delivered order costs per store. */
export default async function FinanceProfitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const state = readReportState(q, today);
  const { from, to } = state;
  const by: Dimension = DIMENSIONS.find((d) => d === q.by) ?? 'store';
  const range = new URLSearchParams({ from, to });
  const back = encodeURIComponent(`/finance/profit?by=${by}&${range}`);
  /** A row opens every income and cost line of its store, merchant or rider. */
  const linesOf = (id: string | null, dimension: Dimension = by) =>
    `/finance/reports/lines?set=income_costs&${dimension}=${id ?? 'none'}&${range}&back=${back}`;
  const [profit, costs, t, locale] = await Promise.all([
    apiGet<{ rows: ProfitRow[]; total: Omit<ProfitRow, 'id' | 'name'> }>(
      `/finance/profit?by=${by}&${range}`,
    ),
    apiGet<{ deliveredOrders: number; companyCostsPiastres: number; rows: CostPerOrderRow[] }>(
      `/finance/cost-per-order?${range}`,
    ),
    getTranslations('finance.profit'),
    getLocale(),
  ]);
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2';
  const money = (v: number | null) => (v === null ? '–' : <Amount piastres={v} />);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <ReportFilterBar
        state={{ ...state, compare: 'none', store: null, merchant: null }}
        today={today}
        compare={false}
        extra={{ by }}
      />
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
                <td className={td}>
                  {by === 'rider' && r.id === null ? (
                    t('companyWide')
                  ) : (
                    <Link href={linesOf(r.id)} className="text-link hover:underline">
                      {r.name ?? t('companyWide')}
                    </Link>
                  )}
                </td>
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
                <td className={td}>
                  <Link href={linesOf(r.store.id, 'store')} className="text-link hover:underline">
                    {locale === 'ar' ? r.store.nameAr : r.store.nameEn}
                  </Link>
                </td>
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

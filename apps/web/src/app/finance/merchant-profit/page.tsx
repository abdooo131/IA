import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import type { MerchantProfitRow } from '@/components/finance/MerchantProfit';
import { apiGet } from '@/lib/api-server';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Profit per merchant for a Cairo month, most profitable first. */
export default async function MerchantProfitPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const q = await searchParams;
  const month = q.month && MONTH.test(q.month) ? q.month : cairoDay(new Date()).slice(0, 7);
  const [data, t] = await Promise.all([
    apiGet<{ month: string; rows: MerchantProfitRow[] }>(`/finance/merchant-profit?month=${month}`),
    getTranslations('finance.merchantProfit'),
  ]);
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2';
  const total = data.rows.reduce(
    (s, r) => ({
      orders: s.orders + r.deliveredOrders,
      fees: s.fees + r.feesPiastres,
      costs: s.costs + r.costsPiastres,
      margin: s.margin + r.marginPiastres,
    }),
    { orders: 0, fees: 0, costs: 0, margin: 0 },
  );
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {t('month')}
          <input
            type="month"
            name="month"
            defaultValue={month}
            dir="ltr"
            className="mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('show')}
        </button>
      </form>
      {data.rows.length === 0 ? (
        <p className="mt-6 text-body-sm text-text-muted">{t('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('merchant')}</th>
                <th className={`${th} text-end`}>{t('orders')}</th>
                <th className={`${th} text-end`}>{t('fees')}</th>
                <th className={`${th} text-end`}>{t('costs')}</th>
                <th className={`${th} text-end`}>{t('margin')}</th>
                <th className={`${th} text-end`}>{t('perOrder')}</th>
                <th className={`${th} text-end`}>{t('marginShare')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.merchant.id} className="border-t border-line">
                  <td className={td}>
                    <Link
                      href={`/finance/merchant-profit/${r.merchant.id}?month=${month}`}
                      className="font-bold text-link"
                    >
                      {r.merchant.name}
                    </Link>
                  </td>
                  <td className={`${td} ltr-iso text-end`}>{r.deliveredOrders}</td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={r.feesPiastres} />
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={r.costsPiastres} />
                  </td>
                  <td className={`${td} text-end font-bold`}>
                    <Amount piastres={r.marginPiastres} />
                  </td>
                  <td className={`${td} text-end`}>
                    {r.marginPerOrderPiastres === null ? (
                      '–'
                    ) : (
                      <Amount piastres={r.marginPerOrderPiastres} />
                    )}
                  </td>
                  <td className={`${td} ltr-iso text-end`}>
                    {r.marginBp === null ? '–' : `${formatEgp(r.marginBp)}%`}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-bold">
                <td className={td}></td>
                <td className={`${td} ltr-iso text-end`}>{total.orders}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={total.fees} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={total.costs} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={total.margin} />
                </td>
                <td className={td}></td>
                <td className={td}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

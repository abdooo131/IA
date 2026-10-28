import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { apiGet } from '@/lib/api-server';
import type { TrialBalance } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function FinanceTrialPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const query = new URLSearchParams();
  if (q.from && DAY.test(q.from)) query.set('from', q.from);
  if (q.to && DAY.test(q.to)) query.set('to', q.to);
  const [tb, t, tf, tj, locale] = await Promise.all([
    apiGet<TrialBalance>(`/finance/trial-balance?${query}`),
    getTranslations('finance.trial'),
    getTranslations('finance'),
    getTranslations('finance.journal'),
    getLocale(),
  ]);
  const balanced = tb.totalDebitPiastres === tb.totalCreditPiastres;
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {tf('from')}
          <input type="date" name="from" defaultValue={q.from ?? ''} dir="ltr" className={field} />
        </label>
        <label className="text-caption">
          {tf('to')}
          <input type="date" name="to" defaultValue={q.to ?? ''} dir="ltr" className={field} />
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {tf('apply')}
        </button>
      </form>
      <p
        role="status"
        className={`mt-4 inline-block rounded-pill border px-3 py-1 text-body-sm font-bold ${balanced ? 'border-line' : 'border-danger text-danger'}`}
      >
        {balanced ? t('balanced') : t('notBalanced')}
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[640px] text-body-sm">
          <thead className="border-b border-line bg-surface-raised">
            <tr>
              <th className={th}>{tj('account')}</th>
              <th className={`${th} text-end`}>{tj('debit')}</th>
              <th className={`${th} text-end`}>{tj('credit')}</th>
              <th className={`${th} text-end`}>{t('balance')}</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <td className="px-3 py-2">
                  <Link href={`/finance/accounts/${r.id}`} className="text-link">
                    <span className="ltr-iso me-2 font-bold">{r.code}</span>
                    {locale === 'ar' ? r.nameAr || r.nameEn : r.nameEn}
                  </Link>
                </td>
                <td className="ltr-iso px-3 py-2 text-end">{formatEgp(r.debitPiastres)}</td>
                <td className="ltr-iso px-3 py-2 text-end">{formatEgp(r.creditPiastres)}</td>
                <td className="px-3 py-2 text-end">
                  <Amount piastres={r.balancePiastres} />
                </td>
              </tr>
            ))}
            <tr className="bg-surface-raised font-bold">
              <td className="px-3 py-2">{t('total')}</td>
              <td className="ltr-iso px-3 py-2 text-end">{formatEgp(tb.totalDebitPiastres)}</td>
              <td className="ltr-iso px-3 py-2 text-end">{formatEgp(tb.totalCreditPiastres)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

import { cairoDay, COMPARE_MODES, isCalendarDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { DateInput } from '@/components/DateInput';
import { Amount } from '@/components/finance/Amount';
import { apiGet } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';

export const dynamic = 'force-dynamic';

interface TagAccountLine {
  accountId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: 'revenue' | 'expense';
  amountPiastres: number;
  compareAmountPiastres: number | null;
}
interface TagRow {
  id: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  incomePiastres: number;
  costsPiastres: number;
  netPiastres: number;
  compareIncomePiastres: number | null;
  compareCostsPiastres: number | null;
  compareNetPiastres: number | null;
  accounts: TagAccountLine[];
}
interface TagReport {
  from: string;
  to: string;
  compare: { mode: string; from: string; to: string } | null;
  rows: TagRow[];
  totals: {
    incomePiastres: number;
    costsPiastres: number;
    netPiastres: number;
    compareIncomePiastres: number | null;
    compareCostsPiastres: number | null;
    compareNetPiastres: number | null;
  };
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const field = 'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const th = 'py-2 pe-3 text-start text-caption font-semibold text-text-muted';
const td = 'py-2 pe-3 align-top';

/**
 * Costs and income by tag: per cost tag, the income and cost accounts its lines touched in the
 * period, with the comparison period; every figure opens its ledger lines.
 */
export default async function TagReportPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const today = cairoDay(new Date());
  const from =
    one(params.from) && isCalendarDay(one(params.from)!)
      ? one(params.from)!
      : `${today.slice(0, 8)}01`;
  const to = one(params.to) && isCalendarDay(one(params.to)!) ? one(params.to)! : today;
  const compare = COMPARE_MODES.find((m) => m === one(params.compare)) ?? 'none';
  const query = new URLSearchParams({ from, to, compare });
  const [report, t, td2, locale] = await Promise.all([
    apiGet<TagReport>(`/finance/cost-tags/report?${query}`),
    getTranslations('loansFx.tagReport'),
    getTranslations('finance.drill'),
    getLocale(),
  ]);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const back = `/finance/reports/tags?${query}`;
  const drill = (extra: Record<string, string>) =>
    `/finance/reports/lines?${new URLSearchParams({
      from,
      to,
      ...extra,
      back,
    })}`;
  const withCompare = report.compare !== null;
  const figure = (value: number, compareValue: number | null, href?: string) => (
    <>
      <td className={`${td} text-end`}>
        {href ? (
          <Link href={href} className="hover:underline">
            <Amount piastres={value} />
          </Link>
        ) : (
          <Amount piastres={value} />
        )}
      </td>
      {withCompare && (
        <td className={`${td} text-end text-text-muted`}>
          <Amount piastres={compareValue ?? 0} />
        </td>
      )}
    </>
  );

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <form
        method="get"
        className="mt-4 grid max-w-3xl grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-3 md:grid-cols-4"
      >
        <label className="text-caption">
          {t('from')}
          <DateInput name="from" defaultValue={from} max={today} dir="ltr" className={field} />
        </label>
        <label className="text-caption">
          {t('to')}
          <DateInput name="to" defaultValue={to} max={today} dir="ltr" className={field} />
        </label>
        <label className="text-caption">
          {td2('compare')}
          <select name="compare" defaultValue={compare} className={field}>
            {COMPARE_MODES.map((m) => (
              <option key={m} value={m}>
                {td2(`compareModes.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary"
          >
            {t('show')}
          </button>
        </div>
      </form>
      <p className="mt-2 text-body-sm text-text-muted">
        {td2('periodDays', { from: isoToDayFirst(from), to: isoToDayFirst(to) })}
        {report.compare &&
          ` · ${td2('comparedWith', {
            from: isoToDayFirst(report.compare.from),
            to: isoToDayFirst(report.compare.to),
          })}`}
      </p>
      {report.rows.length === 0 ? (
        <p className="mt-4 text-body-sm text-text-muted">{t('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface p-3">
          <table className="w-full min-w-[640px] text-body-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t('tag')}</th>
                <th className={`${th} text-end`}>{t('amount')}</th>
                {withCompare && <th className={`${th} text-end`}>{t('compared')}</th>}
              </tr>
            </thead>
            {report.rows.map((r) => (
              <tbody key={r.id} className="border-b border-line">
                <tr className="bg-selected-bg">
                  <td className={`${td} font-bold`}>
                    {name(r)}
                    {!r.isActive && (
                      <span className="ms-2 text-caption text-text-muted">({t('off')})</span>
                    )}
                  </td>
                  <td className={`${td} text-end`} colSpan={withCompare ? 2 : 1}>
                    <Link
                      href={drill({ set: 'income_costs', tag: r.id })}
                      className="text-caption text-link"
                    >
                      {t('allLines')}
                    </Link>
                  </td>
                </tr>
                {r.accounts.map((a) => (
                  <tr key={a.accountId}>
                    <td className={`${td} ps-4`}>
                      <span className="ltr-iso me-2 text-text-muted">{a.code}</span>
                      {name(a)}
                      <span className="ms-2 text-caption text-text-muted">
                        {t(a.category === 'revenue' ? 'income' : 'cost')}
                      </span>
                    </td>
                    {figure(
                      a.amountPiastres,
                      a.compareAmountPiastres,
                      drill({ account: a.accountId, tag: r.id }),
                    )}
                  </tr>
                ))}
                <tr>
                  <td className={`${td} ps-4 text-text-muted`}>{t('income')}</td>
                  {figure(r.incomePiastres, r.compareIncomePiastres)}
                </tr>
                <tr>
                  <td className={`${td} ps-4 text-text-muted`}>{t('costs')}</td>
                  {figure(r.costsPiastres, r.compareCostsPiastres)}
                </tr>
                <tr className="font-bold">
                  <td className={`${td} ps-4`}>{t('net')}</td>
                  {figure(r.netPiastres, r.compareNetPiastres)}
                </tr>
              </tbody>
            ))}
            <tbody>
              <tr className="font-bold">
                <td className={td}>{t('totalCosts')}</td>
                {figure(report.totals.costsPiastres, report.totals.compareCostsPiastres)}
              </tr>
              <tr className="font-bold">
                <td className={td}>{t('totalNet')}</td>
                {figure(report.totals.netPiastres, report.totals.compareNetPiastres)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

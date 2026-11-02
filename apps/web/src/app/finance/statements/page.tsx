import { accountGroup, addDays, cairoDay, isCalendarDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { Amount } from '@/components/finance/Amount';
import { PrintButton } from '@/components/finance/PrintButton';
import { apiGet } from '@/lib/api-server';
import type { ComparativeStatements } from '@/lib/finance-types';
import { FinanceTabs } from '@/components/finance/FinanceTabs';

export const dynamic = 'force-dynamic';

const td = 'py-1.5';

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  const from = q.from && isCalendarDay(q.from) ? q.from : `${lastMonthEnd.slice(0, 7)}-01`;
  const to = q.to && isCalendarDay(q.to) ? q.to : lastMonthEnd;
  const [s, t, ta, locale] = await Promise.all([
    apiGet<ComparativeStatements>(`/finance/comparative-statements?from=${from}&to=${to}`),
    getTranslations('finance.returns'),
    getTranslations('finance.accounts'),
    getLocale(),
  ]);
  const name = (r: { nameEn: string; nameAr: string; groupCode?: number; wallets?: number }) =>
    r.wallets !== undefined && r.groupCode
      ? `${ta.has(`groups.${groupKey(r.groupCode)}`) ? ta(`groups.${groupKey(r.groupCode)}`) : r.groupCode} (${r.wallets})`
      : locale === 'ar'
        ? r.nameAr || r.nameEn
        : r.nameEn || r.nameAr;
  const both = <T extends { code: string }>(a: T[], b: T[]) => {
    const codes = [...new Set([...a, ...b].map((r) => r.code))].sort();
    return codes.map((code) => ({
      code,
      row: (a.find((r) => r.code === code) ?? b.find((r) => r.code === code))!,
      now:
        (a.find((r) => r.code === code) as { amountPiastres?: number } | undefined)
          ?.amountPiastres ?? 0,
      before:
        (b.find((r) => r.code === code) as { amountPiastres?: number } | undefined)
          ?.amountPiastres ?? 0,
    }));
  };
  const head = (
    <tr className="text-label uppercase text-text-muted">
      <th className="py-2 text-start">{t('account')}</th>
      <th className="py-2 text-end ltr-iso">
        {s.current.from} → {s.current.to}
      </th>
      <th className="py-2 text-end ltr-iso">
        {s.previous.from} → {s.previous.to}
      </th>
    </tr>
  );
  const line = (label: string, now: number, before: number, strong = false) => (
    <tr key={label} className={`border-t border-line ${strong ? 'font-bold' : ''}`}>
      <td className={td}>{label}</td>
      <td className={`${td} text-end`}>
        <Amount piastres={now} strong={strong} />
      </td>
      <td className={`${td} text-end`}>
        <Amount piastres={before} strong={strong} />
      </td>
    </tr>
  );
  const bsSection = (title: string, key: 'assets' | 'liabilities' | 'equity') => (
    <>
      <tr>
        <td colSpan={3} className="pt-4 font-bold">
          {title}
        </td>
      </tr>
      {both(s.current.bs[key], s.previous.bs[key]).map((r) =>
        line(`${r.code} ${name(r.row)}`, r.now, r.before),
      )}
    </>
  );
  return (
    <>
      <FinanceTabs family="reports" />
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <h1 className="text-h2">{t('statementsTitle')}</h1>
        <form className="flex flex-wrap items-end gap-2">
          <input
            type="date"
            name="from"
            defaultValue={from}
            dir="ltr"
            className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
          />
          <input
            type="date"
            name="to"
            defaultValue={to}
            dir="ltr"
            className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
          />
          <button className="h-10 rounded-md border border-line px-3 text-body-sm font-bold">
            {t('show')}
          </button>
          <PrintButton />
        </form>
      </div>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted print:hidden">
        {t('statementsIntro')}
      </p>
      <article className="mt-4 max-w-4xl space-y-8 rounded-lg border border-line bg-surface p-6 text-body-sm print:border-0 print:p-0">
        <section>
          <h2 className="text-h3">{t('pl')}</h2>
          <table className="mt-2 w-full">
            <thead>{head}</thead>
            <tbody>
              {both(s.current.pl.income, s.previous.pl.income).map((r) =>
                line(`${r.code} ${name(r.row)}`, r.now, r.before),
              )}
              {line(
                t('totalIncome'),
                s.current.pl.totalIncomePiastres,
                s.previous.pl.totalIncomePiastres,
                true,
              )}
              {both(s.current.pl.expenses, s.previous.pl.expenses).map((r) =>
                line(`${r.code} ${name(r.row)}`, r.now, r.before),
              )}
              {line(
                t('totalCosts'),
                s.current.pl.totalExpensesPiastres,
                s.previous.pl.totalExpensesPiastres,
                true,
              )}
              {line(t('profit'), s.current.pl.profitPiastres, s.previous.pl.profitPiastres, true)}
            </tbody>
          </table>
        </section>
        <section className="break-before-page">
          <h2 className="text-h3">{t('bs', { now: s.current.to, before: s.previous.to })}</h2>
          <table className="mt-2 w-full">
            <thead>{head}</thead>
            <tbody>
              {bsSection(t('assets'), 'assets')}
              {line(
                t('totalAssets'),
                s.current.bs.totalAssetsPiastres,
                s.previous.bs.totalAssetsPiastres,
                true,
              )}
              {bsSection(t('liabilities'), 'liabilities')}
              {bsSection(t('equity'), 'equity')}
              {line(t('earnings'), s.current.bs.earningsPiastres, s.previous.bs.earningsPiastres)}
            </tbody>
          </table>
        </section>
      </article>
    </>
  );
}

function groupKey(code: number) {
  return accountGroup(code)?.key ?? String(code);
}

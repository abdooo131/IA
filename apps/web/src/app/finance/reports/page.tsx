import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { InfoTip, type InfoTerm } from '@/components/odoo/InfoTip';

export const dynamic = 'force-dynamic';

/** Every report, each titled with the plain question it answers. */
const REPORTS: { key: string; href: string; tip?: InfoTerm; accountant?: boolean }[] = [
  { key: 'profitAndLoss', href: '/finance/profit-and-loss' },
  { key: 'balanceSheet', href: '/finance/balance-sheet', tip: 'balanceSheet' },
  { key: 'cashFlow', href: '/finance/money-flow', tip: 'cashFlow' },
  { key: 'cashPosition', href: '/finance/cash-position' },
  { key: 'profitPerStore', href: '/finance/profit' },
  { key: 'merchantProfit', href: '/finance/merchant-profit' },
  { key: 'receivables', href: '/finance/receivables', tip: 'receivables' },
  { key: 'payablesAging', href: '/finance/payables-aging' },
  { key: 'budgets', href: '/finance/budgets' },
  { key: 'comparePeriods', href: '/finance/statements' },
  { key: 'taxes', href: '/finance/taxes' },
  { key: 'trial', href: '/finance/trial', tip: 'trialBalance', accountant: true },
  { key: 'journal', href: '/finance/journal', tip: 'journal', accountant: true },
];

export default async function FinanceReportsPage() {
  const t = await getTranslations('finance.reportsPage');
  const card = (r: (typeof REPORTS)[number]) => (
    <li key={r.key}>
      <div className="flex h-full flex-col rounded-lg border border-line bg-surface p-4 hover:border-primary">
        <h3 className="text-body font-bold">
          <Link href={r.href} className="text-link hover:underline">
            {t(`items.${r.key}.question`)}
          </Link>
        </h3>
        <p className="mt-1 flex-1 text-body-sm text-text-muted">{t(`items.${r.key}.text`)}</p>
        <p className="mt-2 text-caption font-semibold text-text-muted">
          {t(`items.${r.key}.name`)}
          {r.tip && <InfoTip term={r.tip} />}
        </p>
      </div>
    </li>
  );
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.filter((r) => !r.accountant).map(card)}
      </ul>
      <h2 className="mt-8 text-h3">{t('forAccountant')}</h2>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.filter((r) => r.accountant).map(card)}
      </ul>
    </>
  );
}

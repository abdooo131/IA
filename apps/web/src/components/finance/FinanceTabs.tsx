import { getTranslations } from 'next-intl/server';
import { PageTabs } from '@/components/PageTabs';

/** The page families of the finance menu: one link each, the pages as tabs. */
export const FINANCE_FAMILIES = {
  taxes: ['/finance/taxes', '/finance/vat', '/finance/tax-returns'],
  reports: [
    '/finance/profit-and-loss',
    '/finance/balance-sheet',
    '/finance/statements',
    '/finance/profit',
    '/finance/money-flow',
    '/finance/budgets',
    '/finance/trial',
    '/finance/journal',
  ],
  closing: ['/finance/close', '/finance/year-end'],
} as const;

const LABELS: Record<string, string> = {
  '/finance/taxes': 'taxesOwed',
  '/finance/vat': 'vat',
  '/finance/tax-returns': 'taxReturns',
  '/finance/profit-and-loss': 'pl',
  '/finance/balance-sheet': 'bs',
  '/finance/statements': 'statements',
  '/finance/profit': 'profit',
  '/finance/money-flow': 'cashFlow',
  '/finance/budgets': 'budgets',
  '/finance/trial': 'trial',
  '/finance/journal': 'journal',
  '/finance/close': 'closeMonth',
  '/finance/year-end': 'yearEnd',
};

export async function FinanceTabs({ family }: { family: keyof typeof FINANCE_FAMILIES }) {
  const t = await getTranslations('finance.nav');
  return (
    <PageTabs tabs={FINANCE_FAMILIES[family].map((href) => ({ href, label: t(LABELS[href]!) }))} />
  );
}

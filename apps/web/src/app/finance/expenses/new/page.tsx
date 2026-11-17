import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { QuickExpense } from '@/components/finance/QuickExpense';
import type { CostTagOption } from '@/components/finance/CostTagSelect';
import { apiGet } from '@/lib/api-server';
import type { BookAccount, FinanceControls, StoreOption } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** Record an expense: the short form for a cost paid from a bank or cash box. */
export default async function RecordExpensePage() {
  const [accounts, stores, controls, costTags, t] = await Promise.all([
    apiGet<BookAccount[]>('/finance/accounts'),
    apiGet<StoreOption[]>('/finance/stores'),
    apiGet<FinanceControls>('/finance/controls'),
    apiGet<CostTagOption[]>('/finance/cost-tags?active=true'),
    getTranslations('finance.quickExpense'),
  ]);
  // The same choices as the expense on Money movements: open banks and boxes, and the
  // operating and other expense categories.
  const money = accounts.filter((a) => a.money && a.isActive);
  const categories = accounts.filter((a) => [5400, 5500].includes(a.groupCode) && a.isActive);
  return (
    <>
      <div className="flex max-w-2xl flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-h2">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
        </div>
        <Link href="/finance/movements?tab=expense" className="text-body-sm font-bold text-link">
          {t('fullForm')}
        </Link>
      </div>
      <QuickExpense
        money={money}
        categories={categories}
        stores={stores.filter((s) => s.kind === 'dark_store' || s.kind === 'hub')}
        limitPiastres={controls.approvalThresholdPiastres}
        costTags={costTags}
      />
    </>
  );
}

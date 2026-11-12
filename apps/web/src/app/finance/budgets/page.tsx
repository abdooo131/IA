import { cairoDay, canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { BudgetPlan } from '@/components/finance/BudgetPlan';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BudgetYearReport, StoreOption } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** Budgets per quarter, then month, against actual: year, scope and account group in the address. */
export default async function FinanceBudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; scope?: string; group?: string }>;
}) {
  const q = await searchParams;
  const [stores, me, t] = await Promise.all([
    apiGet<StoreOption[]>('/finance/stores'),
    getMyProfile(),
    getTranslations('finance.budgetPlan'),
  ]);
  const canSeeAll = !me || me.allStores;
  const year = q.year && /^\d{4}$/.test(q.year) ? q.year : cairoDay(new Date()).slice(0, 4);
  const allowed = (s: string) =>
    s === 'all' || s === 'company' ? canSeeAll : stores.some((x) => x.id === s);
  const scope =
    q.scope && allowed(q.scope) ? q.scope : canSeeAll ? 'all' : (stores[0]?.id ?? 'all');
  const query = new URLSearchParams({ year, scope });
  if (q.group && /^\d{4}$/.test(q.group)) query.set('group', q.group);
  const report = await apiGet<BudgetYearReport>(`/finance/budgets/year?${query.toString()}`);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <BudgetPlan
        report={report}
        stores={stores}
        canEdit={!!me && canDo(me, 'accounting', 'use')}
        canSeeAll={canSeeAll}
      />
    </>
  );
}

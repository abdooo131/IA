import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { ClaimCategories, type ClaimCategory } from '@/components/finance/ClaimCategories';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/**
 * Employee expense claims as a list view (opens on claims approved and waiting to be paid);
 * each opens its document page to pay or refuse it. Below, which expense categories people may
 * claim.
 */
export default async function ExpenseClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, categories, me, t] = await Promise.all([
    searchParams,
    apiGet<ClaimCategory[]>('/finance/expense-claims/categories'),
    getMyProfile(),
    getTranslations('myPay'),
  ]);
  return (
    <FinanceListPage
      id="expense_claims"
      searchParams={params}
      title={t('financeTitle')}
      intro={t('financeIntro')}
      after={
        <ClaimCategories
          categories={categories}
          canManage={!!me && canDo(me, 'accounting', 'manage')}
        />
      }
    />
  );
}

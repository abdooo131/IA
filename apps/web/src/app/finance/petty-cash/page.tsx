import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { PettyCategories } from '@/components/finance/PettyCashDesk';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { PettyCategory } from '@/lib/cash-control-types';

export const dynamic = 'force-dynamic';

/** Petty cash paid at the stores as a list view (each opens to reverse it), and the categories. */
export default async function FinancePettyCashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, categories, me, t] = await Promise.all([
    searchParams,
    apiGet<PettyCategory[]>('/finance/petty-cash/categories'),
    getMyProfile(),
    getTranslations('cashControl.petty'),
  ]);
  return (
    <FinanceListPage
      id="petty_cash"
      searchParams={params}
      title={t('title')}
      intro={t('intro')}
      after={
        <PettyCategories
          categories={categories}
          canPrepare={!!me && canDo(me, 'accounting', 'use')}
        />
      }
    />
  );
}

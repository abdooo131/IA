import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { NewSupplier } from '@/components/finance/Payables';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** Everyone the company buys from, as a list view, and a form to add a supplier. */
export default async function FinanceSuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, profile, t] = await Promise.all([
    searchParams,
    getMyProfile(),
    getTranslations('finance.payables'),
  ]);
  // Adding a supplier needs accounting use.
  const canAdd = canDo(profile, 'accounting', 'use');
  const accounts = canAdd ? await apiGet<BookAccount[]>('/finance/accounts') : [];
  const expenses = accounts.filter((a) => [5400, 5500].includes(a.groupCode) && a.isActive);
  return (
    <FinanceListPage
      id="suppliers"
      searchParams={params}
      title={t('suppliersTitle')}
      intro={t('suppliersIntro')}
      toolbar={
        canAdd ? (
          <a
            href="#new-supplier"
            className="flex h-11 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
          >
            {t('newSupplier')}
          </a>
        ) : undefined
      }
      after={
        canAdd ? (
          <div id="new-supplier" className="mt-6 max-w-3xl scroll-mt-20">
            <NewSupplier expenses={expenses} />
          </div>
        ) : undefined
      }
    />
  );
}

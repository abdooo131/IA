import { getTranslations } from 'next-intl/server';
import { SuppliersAndBills } from '@/components/finance/Payables';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';
import { apiGet } from '@/lib/api-server';
import type { BillAgeing, BookAccount, StoreOption, SupplierRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** Supplier bills as a list view, then the ageing, a new bill and the suppliers. */
export default async function FinanceBillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, suppliers, ageing, accounts, stores, t] = await Promise.all([
    searchParams,
    apiGet<SupplierRow[]>('/finance/suppliers'),
    apiGet<BillAgeing>('/finance/bills-ageing'),
    apiGet<BookAccount[]>('/finance/accounts'),
    apiGet<StoreOption[]>('/finance/stores'),
    getTranslations('finance.payables'),
  ]);
  return (
    <FinanceListPage
      id="bills"
      searchParams={params}
      title={t('billsTitle')}
      intro={t('billsIntro')}
      toolbar={
        <a
          href="#new-bill"
          className="flex h-11 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
        >
          {t('newBillButton')}
        </a>
      }
      after={
        <SuppliersAndBills
          suppliers={suppliers}
          bills={[]}
          ageing={ageing}
          accounts={accounts}
          stores={stores}
          showOpenBills={false}
        />
      }
    />
  );
}

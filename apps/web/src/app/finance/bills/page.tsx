import { getTranslations } from 'next-intl/server';
import { SuppliersAndBills } from '@/components/finance/Payables';
import { apiGet } from '@/lib/api-server';
import type {
  BillAgeing,
  BillRow,
  BookAccount,
  StoreOption,
  SupplierRow,
} from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceBillsPage() {
  const [suppliers, bills, ageing, accounts, stores, t] = await Promise.all([
    apiGet<SupplierRow[]>('/finance/suppliers'),
    apiGet<BillRow[]>('/finance/bills?status=open'),
    apiGet<BillAgeing>('/finance/bills-ageing'),
    apiGet<BookAccount[]>('/finance/accounts'),
    apiGet<StoreOption[]>('/finance/stores'),
    getTranslations('finance.payables'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('billsTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('billsIntro')}</p>
      <SuppliersAndBills
        suppliers={suppliers}
        bills={bills}
        ageing={ageing}
        accounts={accounts}
        stores={stores}
      />
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';
import {
  type ChequeOptions,
  type ChequeRow,
  ChequeRegisterForm,
  ChequesTable,
} from '@/components/finance/Cheques';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type {
  BillRow,
  BookAccount,
  FinanceOverview,
  PayoutRow,
  SupplierRow,
} from '@/lib/finance-types';
import { canDo } from '@shiplynow/shared';

export const dynamic = 'force-dynamic';

/** The cheques register: what is due, the form to register one, and every cheque (list view). */
export default async function FinanceChequesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, due, profile, t] = await Promise.all([
    searchParams,
    apiGet<{ overdue: ChequeRow[]; thisWeek: ChequeRow[] }>('/finance/cheques-due'),
    getMyProfile(),
    getTranslations('finance.cheques'),
  ]);
  const canUse = canDo(profile, 'accounting', 'use');
  let options: ChequeOptions | null = null;
  if (canUse) {
    const [overview, suppliers, bills, payouts, accounts] = await Promise.all([
      apiGet<FinanceOverview>('/finance/overview'),
      apiGet<SupplierRow[]>('/finance/suppliers'),
      apiGet<BillRow[]>('/finance/bills?status=open'),
      apiGet<PayoutRow[]>('/finance/payouts?status=draft'),
      apiGet<BookAccount[]>('/finance/accounts'),
    ]);
    options = {
      merchants: overview.merchants.map((m) => ({ id: m.id, name: m.name })),
      suppliers: suppliers.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name })),
      bills,
      payouts,
      banks: accounts.filter((a) => a.groupCode === 1100 && a.isActive),
      incomeAccounts: accounts.filter((a) => a.groupCode === 4200 && a.isActive),
    };
  }
  return (
    <FinanceListPage id="cheques" searchParams={params} title={t('title')} intro={t('intro')}>
      <section className="mt-4 grid gap-4">
        <div>
          <h2 className="text-h3 text-danger">
            {t('overdue')} ({due.overdue.length})
          </h2>
          <div className="mt-2">
            {due.overdue.length ? (
              <ChequesTable cheques={due.overdue} />
            ) : (
              <p className="text-body-sm text-text-muted">{t('noneDue')}</p>
            )}
          </div>
        </div>
        <div>
          <h2 className="text-h3">
            {t('thisWeek')} ({due.thisWeek.length})
          </h2>
          <div className="mt-2">
            {due.thisWeek.length ? (
              <ChequesTable cheques={due.thisWeek} />
            ) : (
              <p className="text-body-sm text-text-muted">{t('noneDue')}</p>
            )}
          </div>
        </div>
      </section>

      {options && (
        <div className="mt-6">
          <ChequeRegisterForm options={options} />
        </div>
      )}
    </FinanceListPage>
  );
}

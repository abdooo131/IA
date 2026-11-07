import { CHEQUE_STATUSES } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
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

/** The cheques register: what is due, every cheque, and the form to register one. */
export default async function FinanceChequesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const q = await searchParams;
  const status = CHEQUE_STATUSES.find((s) => s === q.status);
  const [cheques, due, profile, t] = await Promise.all([
    apiGet<ChequeRow[]>(`/finance/cheques${status ? `?status=${status}` : ''}`),
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
  const tab = (value: string | undefined, label: string) => (
    <Link
      key={value ?? 'all'}
      href={value ? `/finance/cheques?status=${value}` : '/finance/cheques'}
      className={`rounded-md px-3 py-2 text-body-sm font-bold ${status === value ? 'bg-selected-bg text-link' : 'text-text-muted'}`}
    >
      {label}
    </Link>
  );
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>

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

      <nav className="mt-6 flex flex-wrap gap-1">
        {tab(undefined, t('all'))}
        {CHEQUE_STATUSES.map((s) => tab(s, t(`statuses.${s}`)))}
      </nav>
      <div className="mt-3">
        <ChequesTable cheques={cheques} />
      </div>
    </>
  );
}

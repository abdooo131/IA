import { canDo, PETTY_CASH_STATUSES } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { PettyCashDesk } from '@/components/finance/PettyCashDesk';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { PettyCashRow, PettyCategory } from '@/lib/cash-control-types';
import type { FinanceOverview } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** Petty cash paid at the stores: filter by store and status, reverse, and the categories. */
export default async function FinancePettyCashPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; status?: string }>;
}) {
  const q = await searchParams;
  const status = PETTY_CASH_STATUSES.find((s) => s === q.status);
  const query = new URLSearchParams({
    ...(q.store ? { darkStoreId: q.store } : {}),
    ...(status ? { status } : {}),
  });
  const [rows, categories, overview, me, t] = await Promise.all([
    apiGet<PettyCashRow[]>(`/finance/petty-cash?${query}`),
    apiGet<PettyCategory[]>('/finance/petty-cash/categories'),
    apiGet<FinanceOverview>('/finance/overview'),
    getMyProfile(),
    getTranslations('cashControl.petty'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <PettyCashDesk
        rows={rows}
        categories={categories}
        stores={overview.stores}
        store={q.store ?? ''}
        status={status ?? ''}
        canPrepare={!!me && canDo(me, 'accounting', 'use')}
        canReverse={!!me && canDo(me, 'accounting', 'manage')}
      />
    </>
  );
}

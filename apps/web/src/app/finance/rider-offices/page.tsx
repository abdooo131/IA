import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { RiderOfficesView } from '@/components/finance/RiderOffices';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { RiderOfficeList, SupplierRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Rider supply offices: their commission, shortages moved onto them and monthly bills. */
export default async function FinanceRiderOfficesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const query = month && MONTH.test(month) ? `?month=${month}` : '';
  const [data, profile, t] = await Promise.all([
    apiGet<RiderOfficeList>(`/finance/rider-offices${query}`),
    getMyProfile(),
    getTranslations('riderOffices'),
  ]);
  const canManage = canDo(profile, 'accounting', 'manage');
  const suppliers = canManage ? await apiGet<SupplierRow[]>('/finance/suppliers') : [];
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <div className="mt-4">
        <RiderOfficesView
          data={data}
          suppliers={suppliers}
          canUse={canDo(profile, 'accounting', 'use')}
          canManage={canManage}
        />
      </div>
    </>
  );
}

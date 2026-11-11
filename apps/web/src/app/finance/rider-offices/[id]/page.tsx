import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { OfficeAccountView, RiderOfficeView } from '@/components/finance/RiderOffices';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { RiderOfficeAccount, RiderOfficeDetail } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One rider office: rate, wallet, daily account, riders, the last 12 months and its bills. */
export default async function FinanceRiderOfficePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const { month } = await searchParams;
  const query = month && MONTH.test(month) ? `?month=${month}` : '';
  const [data, account, profile, t] = await Promise.all([
    apiGet<RiderOfficeDetail>(`/finance/rider-offices/${id}`),
    apiGet<RiderOfficeAccount>(`/finance/rider-offices/${id}/account${query}`),
    getMyProfile(),
    getTranslations('riderOffices'),
  ]);
  return (
    <>
      <Link href="/finance/rider-offices" className="text-body-sm text-link">
        {t('back')}
      </Link>
      <h1 className="mt-2 text-h2">{data.office.name}</h1>
      <p className="mt-1 text-body-sm text-text-muted">
        {data.office.taxId ? t('taxId', { taxId: data.office.taxId }) : t('noTaxIdLong')}
        {data.office.whtBp > 0 && ` · ${t('withholding', { percent: data.office.whtBp / 100 })}`}
      </p>
      <div className="mt-4">
        <RiderOfficeView
          data={data}
          canUse={canDo(profile, 'accounting', 'use')}
          canManage={canDo(profile, 'accounting', 'manage')}
          account={<OfficeAccountView account={account} />}
        />
      </div>
    </>
  );
}

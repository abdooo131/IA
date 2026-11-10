import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { RiderOfficeView } from '@/components/finance/RiderOffices';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { RiderOfficeDetail } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** One rider office: rate, wallet, riders, the last 12 months and its bills. */
export default async function FinanceRiderOfficePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [data, profile, t] = await Promise.all([
    apiGet<RiderOfficeDetail>(`/finance/rider-offices/${id}`),
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
        />
      </div>
    </>
  );
}

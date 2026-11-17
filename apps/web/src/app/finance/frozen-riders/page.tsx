import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { FrozenRiders } from '@/components/finance/FrozenRiders';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { FrozenRider } from '@/lib/basata';

export const dynamic = 'force-dynamic';

/** Riders frozen for cash not handed in by the deposit deadline; Accounting unfreezes them. */
export default async function FrozenRidersPage() {
  const [riders, profile, t] = await Promise.all([
    apiGet<FrozenRider[]>('/finance/frozen-riders'),
    getMyProfile(),
    getTranslations('basata.frozen'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <FrozenRiders riders={riders} canUse={!!profile && canDo(profile, 'accounting', 'use')} />
    </>
  );
}

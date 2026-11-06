import { getTranslations } from 'next-intl/server';
import { canDo } from '@shiplynow/shared';
import {
  type AccountManagerOption,
  type AdminMerchant,
  MerchantsManager,
} from '@/components/admin/MerchantsManager';
import { PendingSignUps } from '@/components/admin/PendingSignUps';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AdminMerchantsPage() {
  const [merchants, profile, t] = await Promise.all([
    apiGet<AdminMerchant[]>('/admin/merchants'),
    getMyProfile(),
    getTranslations('admin.merchants'),
  ]);
  const canAssign = canDo(profile, 'merchants', 'manage') && !profile?.ownMerchantsOnly;
  const managers = canAssign ? await apiGet<AccountManagerOption[]>('/admin/account-managers') : [];
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <PendingSignUps merchants={merchants.filter((m) => m.approval === 'pending')} />
      <MerchantsManager
        merchants={merchants.filter((m) => m.approval !== 'pending')}
        managers={managers}
        canAssign={canAssign}
      />
    </>
  );
}

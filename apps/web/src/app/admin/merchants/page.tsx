import { getTranslations } from 'next-intl/server';
import { canDo } from '@shiplynow/shared';
import { type AdminMerchant, NewMerchantButton } from '@/components/admin/MerchantsManager';
import { PendingSignUps } from '@/components/admin/PendingSignUps';
import { AppListPage } from '@/components/odoo/AppListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/**
 * Merchants as a list (UX phase C step 3): search by name, contact, Shopify store or account
 * manager; filters, grouping, wallet totals and bulk approve, pause and open; each opens the
 * merchant's page. Sign ups waiting for a decision stay listed above with Approve and Reject.
 */
export default async function AdminMerchantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, profile, t, tl] = await Promise.all([
    searchParams,
    getMyProfile(),
    getTranslations('admin.merchants'),
    getTranslations('appLists.merchants'),
  ]);
  const canDecide = canDo(profile, 'merchants', 'manage');
  const pending = canDecide
    ? (await apiGet<AdminMerchant[]>('/admin/merchants')).filter((m) => m.approval === 'pending')
    : [];
  return (
    <AppListPage
      list="merchants/merchants"
      searchParams={params}
      title={t('title')}
      intro={tl('intro')}
      toolbar={canDo(profile, 'merchants', 'use') ? <NewMerchantButton /> : undefined}
    >
      <PendingSignUps merchants={pending} />
    </AppListPage>
  );
}

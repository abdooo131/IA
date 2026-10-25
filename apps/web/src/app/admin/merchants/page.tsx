import { getTranslations } from 'next-intl/server';
import { type AdminMerchant, MerchantsManager } from '@/components/admin/MerchantsManager';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AdminMerchantsPage() {
  const [merchants, t] = await Promise.all([
    apiGet<AdminMerchant[]>('/admin/merchants'),
    getTranslations('admin.merchants'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <MerchantsManager merchants={merchants} />
    </>
  );
}

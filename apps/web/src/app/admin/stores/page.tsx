import { getTranslations } from 'next-intl/server';
import { LocationsManager } from '@/components/admin/LocationsManager';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AdminStoresPage() {
  const [stores, governorates, t] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<{ id: number; nameEn: string; nameAr: string }[]>('/admin/dark-stores/governorates'),
    getTranslations('admin.locations'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
      <LocationsManager stores={stores} governorates={governorates} />
    </>
  );
}

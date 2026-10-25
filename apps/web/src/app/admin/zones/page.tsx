import { getTranslations } from 'next-intl/server';
import { ZonesWorkspace } from '@/components/admin/ZonesWorkspace';
import type { AdminStore, AdminZone } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AdminZonesPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const [stores, zones, t, { store }] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<AdminZone[]>('/admin/zones'),
    getTranslations('admin.zones'),
    searchParams,
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <ZonesWorkspace stores={stores} zones={zones} initialStoreId={store} />
    </>
  );
}

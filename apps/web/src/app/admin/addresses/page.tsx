import { getTranslations } from 'next-intl/server';
import { AddressMapManager } from '@/components/geo/AddressMapManager';
import { apiGet } from '@/lib/api-server';
import type { GeoOverview, GeoSuggestion } from '@/lib/geo-types';

export const dynamic = 'force-dynamic';

export default async function AdminAddressesPage() {
  const [overview, suggestions, t] = await Promise.all([
    apiGet<GeoOverview>('/admin/geo'),
    apiGet<GeoSuggestion[]>('/admin/geo/suggestions'),
    getTranslations('geo'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <AddressMapManager overview={overview} suggestions={suggestions} />
    </>
  );
}

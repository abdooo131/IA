import { getTranslations } from 'next-intl/server';
import { type ShopifyOverview, ShopifyManager } from '@/components/admin/ShopifyManager';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AdminShopifyPage() {
  const [data, merchants, t] = await Promise.all([
    apiGet<ShopifyOverview>('/admin/shopify'),
    apiGet<{ id: string; name: string; isActive: boolean }[]>('/admin/merchants'),
    getTranslations('admin.shopify'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <ShopifyManager data={data} merchants={merchants.filter((m) => m.isActive)} />
    </>
  );
}

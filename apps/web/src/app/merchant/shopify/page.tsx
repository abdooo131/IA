import { getTranslations } from 'next-intl/server';
import { ShopifyConnect, type MerchantShopify } from '@/components/merchant/ShopifyConnect';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function MerchantShopifyPage() {
  const [data, t] = await Promise.all([
    apiGet<MerchantShopify>('/merchant/shopify'),
    getTranslations('merchant.shopify'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('intro')}</p>
      <ShopifyConnect data={data} />
    </>
  );
}

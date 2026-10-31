import { getTranslations } from 'next-intl/server';
import { BackLink } from '@/components/store/BackLink';
import { type CoverageArea, NewOrderForm } from '@/components/orders/NewOrderForm';
import { apiGet } from '@/lib/api-server';
import type { MerchantSku } from '@/lib/merchant-types';

export const dynamic = 'force-dynamic';

export default async function MerchantNewOrderPage() {
  const [areas, skus, t] = await Promise.all([
    apiGet<CoverageArea[]>('/coverage/areas'),
    apiGet<MerchantSku[]>('/merchant/skus'),
    getTranslations('merchant.orders'),
  ]);
  return (
    <>
      <BackLink href="/merchant/orders" />
      <h1 className="text-h2">{t('newTitle')}</h1>
      <NewOrderForm
        endpoint="/merchant/orders"
        detailBase="/merchant/orders"
        areas={areas}
        skus={skus}
      />
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import { BackLink } from '@/components/store/BackLink';
import { NewOrderForm } from '@/components/orders/NewOrderForm';
import { apiGet, requireMerchantRight } from '@/lib/api-server';
import type { MerchantSku } from '@/lib/merchant-types';

export const dynamic = 'force-dynamic';

export default async function MerchantNewOrderPage() {
  await requireMerchantRight('orders');
  const [skus, delivery, t] = await Promise.all([
    apiGet<MerchantSku[]>('/merchant/skus'),
    apiGet<{ expressPricePiastres: number | null }>('/merchant/delivery'),
    getTranslations('merchant.orders'),
  ]);
  return (
    <>
      <BackLink href="/merchant/orders" />
      <h1 className="text-h2">{t('newTitle')}</h1>
      <NewOrderForm
        endpoint="/merchant/orders"
        detailBase="/merchant/orders"
        skus={skus}
        defaultFeePiastres={delivery.expressPricePiastres}
      />
    </>
  );
}

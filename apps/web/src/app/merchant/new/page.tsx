import { getTranslations } from 'next-intl/server';
import { NewShipmentForm } from '@/components/merchant/NewShipmentForm';
import { apiGet } from '@/lib/api-server';
import type { MerchantSku } from '@/lib/merchant-types';
import type { StoreRef } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function NewShipmentPage() {
  const [stores, skus, t] = await Promise.all([
    apiGet<StoreRef[]>('/merchant/dark-stores'),
    apiGet<MerchantSku[]>('/merchant/skus'),
    getTranslations('merchant.new'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <NewShipmentForm stores={stores} skus={skus} />
    </>
  );
}

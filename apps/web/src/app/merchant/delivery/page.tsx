import { getTranslations } from 'next-intl/server';
import { DeliveryPriceForm } from '@/components/merchant/DeliveryPriceForm';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export interface MerchantDelivery {
  expressPricePiastres: number | null;
  shopify: { status: 'pending' | 'active' | 'uninstalled'; checkoutRateReady: boolean } | null;
}

export default async function MerchantDeliveryPage() {
  const [delivery, t] = await Promise.all([
    apiGet<MerchantDelivery>('/merchant/delivery'),
    getTranslations('merchant.delivery'),
  ]);
  const ready = delivery.shopify?.status === 'active' && delivery.shopify.checkoutRateReady;
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('intro')}</p>
      <div className="mt-4 max-w-xl space-y-4 rounded-lg border border-line bg-surface p-5 shadow-sm">
        <DeliveryPriceForm price={delivery.expressPricePiastres} />
        <p
          className={`rounded-md border px-3 py-2 text-body-sm ${
            ready ? 'border-status-delivered' : 'border-status-needs-action'
          }`}
        >
          {ready ? t('checkoutReady') : t('checkoutNotReady')}
        </p>
      </div>
      <h2 className="mt-6 text-h3">{t('rulesTitle')}</h2>
      <ul className="mt-2 max-w-2xl list-inside list-disc space-y-1 text-body-sm">
        <li>{t('ruleZone')}</li>
        <li>{t('ruleOpen')}</li>
        <li>{t('ruleStock')}</li>
        <li>{t('ruleOtherwise')}</li>
      </ul>
    </>
  );
}

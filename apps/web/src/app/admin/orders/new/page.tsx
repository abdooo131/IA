import { getTranslations } from 'next-intl/server';
import { BackLink } from '@/components/store/BackLink';
import { type CoverageArea, NewOrderForm } from '@/components/orders/NewOrderForm';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

interface AdminSku {
  id: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  isActive: boolean;
  merchant: { id: string; name: string };
}

export default async function AdminNewOrderPage() {
  const [areas, skus, merchants, t] = await Promise.all([
    apiGet<CoverageArea[]>('/coverage/areas'),
    apiGet<AdminSku[]>('/admin/skus'),
    apiGet<{ id: string; name: string; isActive: boolean }[]>('/admin/merchants'),
    getTranslations('merchant.orders'),
  ]);
  return (
    <>
      <BackLink href="/admin/orders" />
      <h1 className="text-h2">{t('newTitle')}</h1>
      <NewOrderForm
        endpoint="/admin/orders"
        detailBase="/admin/orders"
        areas={areas}
        skus={skus.filter((s) => s.isActive).map((s) => ({ ...s, merchantId: s.merchant.id }))}
        merchants={merchants.filter((m) => m.isActive)}
      />
    </>
  );
}

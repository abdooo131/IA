import { getTranslations } from 'next-intl/server';
import { ProductsManager } from '@/components/admin/ProductsManager';
import type { AdminSku } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string; q?: string }>;
}) {
  const filters = await searchParams;
  const [skus, merchants, t] = await Promise.all([
    apiGet<AdminSku[]>('/admin/skus'),
    apiGet<{ id: string; name: string; isActive: boolean }[]>('/admin/merchants'),
    getTranslations('admin.products'),
  ]);
  const q = filters.q?.trim().toLowerCase();
  const shown = skus.filter(
    (s) =>
      (!filters.merchant || s.merchant.id === filters.merchant) &&
      (!q ||
        s.sku.toLowerCase().includes(q) ||
        (s.barcode ?? '').toLowerCase().includes(q) ||
        s.titleEn.toLowerCase().includes(q) ||
        s.titleAr.includes(filters.q!.trim())),
  );
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <ProductsManager
        key={`${filters.merchant ?? ''}|${filters.q ?? ''}`}
        skus={shown}
        merchants={merchants}
        filters={{ merchant: filters.merchant ?? '', q: filters.q ?? '' }}
      />
    </>
  );
}

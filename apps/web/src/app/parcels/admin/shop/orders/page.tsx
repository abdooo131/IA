'use client';
import { PackagingOrders } from '@/parcels/components/PackagingOrders';
import { PageHeader } from '@/parcels/components/ui';
import { useT } from '@/parcels/lib/i18n';

export default function ShopOrdersPage() {
  const t = useT();
  return (
    <div className="space-y-5">
      <PageHeader title={t('Packaging orders')} subtitle={t('Merchants order from the shop in their panel. Pack, hand to a courier; the merchant gives the courier the code from their SMS')} />
      <PackagingOrders couriersPath="/admin/users" />
    </div>
  );
}

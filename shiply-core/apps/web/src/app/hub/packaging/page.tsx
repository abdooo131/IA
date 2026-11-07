'use client';
import { useHub } from '@/components/HubContext';
import { PackagingOrders } from '@/components/PackagingOrders';
import { PageHeader } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function HubPackagingPage() {
  const t = useT();
  const hub = useHub();
  return (
    <div className="space-y-5">
      <PageHeader title={t('Packaging orders')} subtitle={t('Pack each order from the shelf and give it to the courier going to that merchant')} />
      <PackagingOrders hubId={hub.id} couriersPath={`/hubs/${hub.id}/couriers`} />
    </div>
  );
}

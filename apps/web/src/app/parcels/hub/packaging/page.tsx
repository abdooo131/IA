'use client';
import { useHub } from '@/parcels/components/HubContext';
import { PackagingOrders } from '@/parcels/components/PackagingOrders';
import { PageHeader } from '@/parcels/components/ui';
import { useT } from '@/parcels/lib/i18n';

export default function HubPackagingPage() {
  const t = useT();
  const hub = useHub();
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Packaging orders')}
        subtitle={t(
          'Pack each order from the shelf and give it to the courier going to that merchant',
        )}
      />
      <PackagingOrders hubId={hub.id} couriersPath={`/hubs/${hub.id}/couriers`} />
    </div>
  );
}

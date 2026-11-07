'use client';
import { useMe } from '@/parcels/components/Shell';
import { Card, Loading, PageHeader } from '@/parcels/components/ui';
import {
  VehicleRequestsTable,
  VehiclesPanel,
  type Vehicle,
  type VehicleRequestRow,
} from '@/parcels/components/workforce';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

export default function AgentVehicles() {
  const t = useT();
  const me = useMe();
  const requests = useLoad<VehicleRequestRow[]>('/agent/vehicle-requests');
  const vehicles = useLoad<Vehicle[]>('/agent/vehicles');
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={me.agent?.name}
        title={t('Vehicles')}
        subtitle={t('Your fleet and special vehicle requests from operations')}
      />
      <Card title={t('Special vehicle requests')}>
        {requests.data ? (
          <VehicleRequestsTable
            rows={requests.data}
            vehicles={vehicles.data ?? []}
            provideBase="/agent/vehicle-requests"
            onChange={() => void requests.reload()}
          />
        ) : (
          <Loading />
        )}
      </Card>
      <VehiclesPanel base="/agent" />
    </div>
  );
}

'use client';
import { useState } from 'react';
import { useHub } from '@/components/HubContext';
import { Alert, Badge, Card, Empty, Loading, PageHeader, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

type Pickup = { id: string; code: string; date: string; status: string; courierId: string | null; expectedCount: number; notes: string; merchant: { name: string; phone: string; pickupAddress: string } };

export default function PickupsPage() {
  const hub = useHub();
  const pickups = useLoad<Pickup[]>(`/hubs/${hub.id}/pickups`);
  const couriers = useLoad<{ id: string; name: string }[]>(`/hubs/${hub.id}/couriers`);
  const [error, setError] = useState<string | null>(null);

  const assign = async (p: Pickup, courierId: string) => {
    setError(null);
    try {
      await api(`/hubs/${hub.id}/pickups/${p.id}/assign`, { body: { courierId } });
      await pickups.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="Pickups" subtitle="Merchants ask for a pickup. Give each one to a courier. The courier scans every parcel at the merchant, then you receive them on the Receive page." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!pickups.data ? <Loading /> : pickups.data.length === 0 ? <Empty>No open pickups.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {pickups.data.map((p) => (
            <Card key={p.id} title={<span>{p.merchant.name} <span className="font-mono text-sm text-slate-500">{p.code}</span></span>} actions={<Badge tone={p.status === 'REQUESTED' ? 'amber' : p.status === 'COLLECTED' ? 'green' : 'blue'}>{p.status.toLowerCase()}</Badge>}>
              <dl className="grid grid-cols-3 gap-y-1 text-sm">
                <dt className="text-slate-500">Date</dt><dd className="col-span-2">{shortDate(p.date)}</dd>
                <dt className="text-slate-500">Address</dt><dd className="col-span-2">{p.merchant.pickupAddress}</dd>
                <dt className="text-slate-500">Phone</dt><dd className="col-span-2"><a className="text-brand-700" href={`tel:${p.merchant.phone}`}>{p.merchant.phone}</a></dd>
                <dt className="text-slate-500">Parcels</dt><dd className="col-span-2">about {p.expectedCount}</dd>
                {p.notes && (<><dt className="text-slate-500">Notes</dt><dd className="col-span-2">{p.notes}</dd></>)}
              </dl>
              {(p.status === 'REQUESTED' || p.status === 'ASSIGNED') && (
                <label className="mt-3 block text-sm">
                  <span className="mb-1 block font-medium">Courier</span>
                  <Select value={p.courierId ?? ''} onChange={(e) => e.target.value && void assign(p, e.target.value)}>
                    <option value="">Choose a courier</option>
                    {couriers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </label>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

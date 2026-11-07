'use client';
import { useState } from 'react';
import { ScanBox } from '@/components/ScanBox';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

type Pickup = { id: string; code: string; date: string; status: string; expectedCount: number; collected: number; notes: string; merchant: { name: string; phone: string; pickupAddress: string } };

export default function CourierPickupsPage() {
  const pickups = useLoad<Pickup[]>('/courier/pickups');
  const [error, setError] = useState<string | null>(null);

  const finish = async (p: Pickup) => {
    setError(null);
    try {
      await api(`/courier/pickups/${p.id}/finish`, { body: {} });
      await pickups.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="Pickups" subtitle="At the merchant, scan every parcel label before it goes in your vehicle." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!pickups.data ? <Loading /> : pickups.data.length === 0 ? <Empty>No pickups for you.</Empty> : (
        <div className="space-y-4">
          {pickups.data.map((p) => (
            <Card key={p.id} title={p.merchant.name} actions={<Badge tone={p.status === 'ASSIGNED' ? 'amber' : 'green'}>{p.status === 'ASSIGNED' ? 'To collect' : 'Take to hub'}</Badge>}>
              <p className="text-sm">{p.merchant.pickupAddress}</p>
              <p className="mt-1 text-xs text-slate-500">{shortDate(p.date)} · {p.code} · about {p.expectedCount} parcels{p.notes ? ` · ${p.notes}` : ''}</p>
              <div className="mt-3 flex gap-2">
                <a href={`tel:${p.merchant.phone}`} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold">Call</a>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.merchant.pickupAddress)}`} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold">Map</a>
              </div>
              <p className="mt-3 text-sm font-semibold">Collected: {p.collected}</p>
              {p.status === 'ASSIGNED' && (
                <div className="mt-3 space-y-3">
                  <ScanBox
                    label="Scan parcel label"
                    onScan={async (code) => {
                      const r = await api(`/courier/pickups/${p.id}/collect`, { body: { code } });
                      void pickups.reload();
                      return r.message;
                    }}
                  />
                  <Button className="w-full" tone="success" disabled={p.collected === 0} onClick={() => void finish(p)}>Done, leaving the merchant</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

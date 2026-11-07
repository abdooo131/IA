'use client';
import { Fragment, useState } from 'react';
import { useHub } from '@/components/HubContext';
import { ScanBox } from '@/components/ScanBox';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

type Bag = { id: string; code: string; originHubId: string; destinationHubId: string; status: string; parcels: number; createdAt: string; tripId: string | null };
type Hub = { id: string; code: string; name: string };

export default function SortPage() {
  const hub = useHub();
  const bags = useLoad<Bag[]>(`/hubs/${hub.id}/bags`);
  const hubs = useLoad<Hub[]>('/reference/hubs');
  const [open, setOpen] = useState<string | null>(null);
  const [contents, setContents] = useState<{ trackingNumber: string; customerName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const hubCode = (id: string) => hubs.data?.find((h) => h.id === id)?.code ?? '';

  const show = async (bag: Bag) => {
    if (open === bag.id) return setOpen(null);
    const b = await api(`/hubs/${hub.id}/bags/${bag.id}`);
    setContents(b.parcels);
    setOpen(bag.id);
  };

  const seal = async (bag: Bag) => {
    setError(null);
    try {
      await api(`/hubs/${hub.id}/bags/${bag.id}/seal`, { body: {} });
      await bags.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (bag: Bag, code: string) => {
    setError(null);
    try {
      await api(`/hubs/${hub.id}/bags/${bag.id}/remove`, { body: { code } });
      setContents((c) => c.filter((p) => p.trackingNumber !== code));
      await bags.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const outgoing = (bags.data ?? []).filter((b) => b.originHubId === hub.id);
  const incoming = (bags.data ?? []).filter((b) => b.destinationHubId === hub.id && b.status === 'IN_TRANSIT');

  return (
    <>
      <PageHeader title="Sort and bags" subtitle="Scan a parcel and the system tells you which bag it goes in. Seal a bag when it is full or the truck is ready." />
      <Card title="Sort a parcel">
        <ScanBox
          label="Parcel tracking number"
          onScan={async (code) => {
            const r = await api(`/hubs/${hub.id}/sort`, { body: { code } });
            void bags.reload();
            return (
              <span className="flex flex-wrap items-center gap-3">
                <span className="rounded-lg bg-brand-600 px-3 py-1 text-2xl font-black text-white">{r.next.hubCode}</span>
                <span>{r.message}</span>
              </span>
            );
          }}
        />
      </Card>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <Card title="Bags leaving this hub" className="mt-4">
        {!bags.data ? <Loading /> : outgoing.length === 0 ? <Empty>No bags yet. Sorting a parcel opens one.</Empty> : (
          <Table head={['Bag', 'To', 'Parcels', 'Status', 'Opened', '']}>
            {outgoing.map((b) => (
              <Fragment key={b.id}>
                <tr>
                  <Td className="font-mono font-semibold">{b.code}</Td>
                  <Td><span className="text-lg font-bold">{hubCode(b.destinationHubId)}</span></Td>
                  <Td>{b.parcels}</Td>
                  <Td><Badge tone={b.status === 'OPEN' ? 'amber' : 'green'}>{b.status === 'OPEN' ? 'Open' : b.tripId ? 'Sealed, on a trip' : 'Sealed'}</Badge></Td>
                  <Td>{dateTime(b.createdAt)}</Td>
                  <Td className="space-x-2">
                    <Button tone="ghost" onClick={() => void show(b)}>{open === b.id ? 'Hide' : 'Contents'}</Button>
                    {b.status === 'OPEN' && <Button tone="secondary" onClick={() => void seal(b)}>Seal</Button>}
                  </Td>
                </tr>
                {open === b.id && (
                  <tr>
                    <td colSpan={6} className="bg-slate-50 px-3 py-2">
                      <ul className="space-y-1 text-sm">
                        {contents.map((p) => (
                          <li key={p.trackingNumber} className="flex items-center justify-between gap-2">
                            <span><span className="font-mono">{p.trackingNumber}</span> · {p.customerName}</span>
                            {b.status === 'OPEN' && <Button tone="ghost" onClick={() => void remove(b, p.trackingNumber)}>Take out</Button>}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Bags on their way here" className="mt-4">
        {incoming.length === 0 ? <Empty>No bags on the road to this hub.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {incoming.map((b) => (
              <li key={b.id} className="flex justify-between py-2"><span className="font-mono font-semibold">{b.code}</span><span>{b.parcels} parcels from {hubCode(b.originHubId)}</span></li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">When they arrive, scan the bag on the Receive page.</p>
      </Card>
    </>
  );
}

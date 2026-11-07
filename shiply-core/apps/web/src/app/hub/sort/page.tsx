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

  return (
    <>
      <PageHeader
        title={hub.isSorting ? `Sorting · ${hub.name}` : `Send back · ${hub.name}`}
        subtitle={hub.isSorting
          ? 'Sorting team: scan each parcel inbound handed over. The system routes it to the bag for its last mile hub or the next facility, or to the return shelf. Seal full bags; outbound takes them over.'
          : 'Scan returns and rerouted parcels into the bag for the sorting facility, seal it, then send it on a trip.'}
      />
      <Card title="Sort a parcel">
        <ScanBox
          label="Parcel tracking number"
          onScan={async (code) => {
            const r = await api(`/hubs/${hub.id}/sort`, { body: { code } });
            void bags.reload();
            if (!r.bag) return <span className="flex flex-wrap items-center gap-3"><span className="rounded-lg bg-rose-600 px-3 py-1 text-lg font-black text-white">RETURN</span><span>{r.message}</span></span>;
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
                  <Td><Badge tone={b.status === 'OPEN' ? 'amber' : 'green'}>{b.status === 'OPEN' ? 'Open' : b.status === 'HANDED_OVER' ? (b.tripId ? 'With outbound, on a trip' : 'With outbound') : b.tripId ? 'Sealed, on a trip' : hub.isSorting ? 'Sealed, waiting for outbound' : 'Sealed'}</Badge></Td>
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
    </>
  );
}

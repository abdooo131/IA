'use client';
import { FAIL_REASONS, type FailReason } from '@shiply/shared';
import { useHub } from '@/components/HubContext';
import { ScanBox } from '@/components/ScanBox';
import { Badge, Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { nextText } from '@/lib/hub';

type Row = { id: string; trackingNumber: string; merchant: string; customerName: string; governorateCode: string; codAmount: number; attempts: number; promisedDate: string | null; direction: string; holdReason: string | null; nextHub: string | null };
type OnHand = { hub: { isSorting: boolean }; groups: { key: string; title: string; hint: string; rows: Row[] }[] };

export default function InboundPage() {
  const hub = useHub();
  const { data, reload } = useLoad<OnHand>(`/hubs/${hub.id}/on-hand`);
  const facility = hub.isSorting;

  return (
    <>
      <PageHeader
        title={facility ? `Inbound · ${hub.name}` : `Receive · ${hub.name}`}
        subtitle={
          facility
            ? 'Inbound team: scan every parcel that arrives (pickups, drop offs, line haul bags, returns). The screen says where it goes next; hand it to the sorting team.'
            : 'Scan line haul bags and parcels couriers bring back. Parcels for delivery stay here; returns go back to the sorting facility.'
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scan parcels in">
          <ScanBox
            label="Parcel tracking number"
            onScan={async (code) => {
              const r = await api(`/hubs/${hub.id}/inbound`, { body: { code } });
              void reload();
              return (
                <>
                  {r.message}. <strong>{nextText(r.next, facility)}</strong>
                  {r.warning && <span className="mt-1 block text-amber-800">{r.warning}</span>}
                </>
              );
            }}
          />
        </Card>
        <Card title="Receive a whole bag">
          <ScanBox
            label="Bag code from a line haul trip"
            placeholder="BG00123"
            autoFocus={false}
            onScan={async (code) => {
              const r = await api(`/hubs/${hub.id}/receive-bag`, { body: { code } });
              void reload();
              return <>{r.message}{r.warning && <span className="mt-1 block text-amber-800">{r.warning}</span>}</>;
            }}
          />
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">In this building now</h2>
      {!data ? <Loading /> : (
        <div className="space-y-4">
          {data.groups.map((g) => (
            <Card key={g.key} title={<span>{g.title} <Badge tone="blue">{g.rows.length}</Badge></span>}>
              <p className="-mt-2 mb-3 text-xs text-slate-500">{g.hint}</p>
              {g.rows.length === 0 ? <Empty>Nothing here</Empty> : (
                <Table head={['Parcel', 'Merchant', 'Customer', 'Next', 'COD', 'Promised', g.key === 'onHold' ? 'Reason' : 'Attempts']}>
                  {g.rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-mono">{r.trackingNumber} {r.direction === 'RETURN' && <Badge tone="red">return</Badge>}</Td>
                      <Td>{r.merchant}</Td>
                      <Td>{r.customerName}</Td>
                      <Td className="font-semibold">{r.nextHub ?? (r.direction === 'RETURN' ? 'Merchant' : r.governorateCode)}</Td>
                      <Td>{egp(r.codAmount)}</Td>
                      <Td>{shortDate(r.promisedDate)}</Td>
                      <Td>{g.key === 'onHold' ? FAIL_REASONS[r.holdReason as FailReason]?.label ?? r.holdReason : r.attempts}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

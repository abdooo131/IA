'use client';
import Link from 'next/link';
import { useHub } from '@/components/HubContext';
import { ScanBox } from '@/components/ScanBox';
import { Badge, Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { nextText } from '@/lib/hub';
import { FAIL_REASONS, type FailReason } from '@shiply/shared';

type Row = { id: string; trackingNumber: string; merchant: string; customerName: string; governorateCode: string; codAmount: number; attempts: number; promisedDate: string | null; direction: string; holdReason: string | null; nextHub: string | null };
type OnHand = Record<'toSort' | 'toDeliver' | 'toReturn' | 'onHold' | 'bagged' | 'onRun', Row[]>;

const GROUPS: { key: keyof OnHand; title: string; hint: string }[] = [
  { key: 'toSort', title: 'To sort', hint: 'Going to another hub. Open Sort and bags.' },
  { key: 'toDeliver', title: 'Ready for delivery', hint: 'Load these on courier runs.' },
  { key: 'toReturn', title: 'Ready to return to merchant', hint: 'Load these on a courier run as returns.' },
  { key: 'onHold', title: 'On hold', hint: 'Waiting for the merchant to decide.' },
  { key: 'bagged', title: 'In bags', hint: 'Sorted into a bag that has not left yet.' },
  { key: 'onRun', title: 'Loaded on runs', hint: 'On a courier run that has not left yet.' },
];

export default function ReceivePage() {
  const hub = useHub();
  const { data, reload } = useLoad<OnHand>(`/hubs/${hub.id}/on-hand`);

  return (
    <>
      <PageHeader title={`Receive at ${hub.code}`} subtitle="Scan every parcel that comes in: merchant drop offs, pickups, line haul, and parcels couriers bring back." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scan parcels in">
          <ScanBox
            label="Parcel tracking number"
            onScan={async (code) => {
              const r = await api(`/hubs/${hub.id}/inbound`, { body: { code } });
              void reload();
              return (
                <>
                  {r.message}. <strong>{nextText(r.next)}</strong>
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
            onScan={async (code) => {
              const r = await api(`/hubs/${hub.id}/receive-bag`, { body: { code } });
              void reload();
              return <>{r.message}{r.warning && <span className="mt-1 block text-amber-800">{r.warning}</span>}</>;
            }}
          />
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">In this hub now</h2>
      {!data ? <Loading /> : (
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <Card key={g.key} title={<span>{g.title} <Badge tone="blue">{data[g.key].length}</Badge></span>}>
              <p className="-mt-2 mb-3 text-xs text-slate-500">{g.hint}</p>
              {data[g.key].length === 0 ? <Empty>Nothing here</Empty> : (
                <Table head={['Parcel', 'Merchant', 'Customer', 'To', 'COD', 'Promised', g.key === 'onHold' ? 'Reason' : 'Attempts']}>
                  {data[g.key].map((r) => (
                    <tr key={r.id}>
                      <Td className="font-mono">{r.trackingNumber}{r.direction === 'RETURN' && <Badge tone="red">return</Badge>}</Td>
                      <Td>{r.merchant}</Td>
                      <Td>{r.customerName}</Td>
                      <Td>{r.nextHub ?? r.governorateCode}</Td>
                      <Td>{egp(r.codAmount)}</Td>
                      <Td>{shortDate(r.promisedDate)}</Td>
                      <Td>{g.key === 'onHold' ? FAIL_REASONS[r.holdReason as FailReason]?.label ?? r.holdReason : r.attempts}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              {g.key === 'toSort' && data.toSort.length > 0 && <Link href="/hub/sort" className="mt-3 inline-block text-sm font-semibold text-brand-700">Go to sorting</Link>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

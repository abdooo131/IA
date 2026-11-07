'use client';
import Link from 'next/link';
import { SHIPMENT_STATUSES } from '@shiply/shared';
import { Alert, Card, Loading, PageHeader, Stat, StatusBadge, Table, Td } from '@/components/ui';
import { egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

interface Dashboard {
  today: string;
  byStatus: Record<string, number>;
  late: number;
  enteredToday: number;
  deliveredToday: number;
  failedToday: number;
  dueToday: number;
  deliveredOnTime: number;
  cashWithCouriers: number;
  tripsOnTheRoad: number;
  hubs: { id: string; code: string; name: string; isSorting: boolean; atHub: number; onHold: number }[];
}

export default function AdminDashboard() {
  const { data, error, loading } = useLoad<Dashboard>('/admin/dashboard');
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={`Today, ${shortDate(data.today)}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Entered today" value={data.enteredToday} hint="Picked up or dropped off" />
        <Stat label="Delivered today" value={data.deliveredToday} />
        <Stat label="Due today" value={data.dueToday} hint={`${data.deliveredOnTime} delivered on time`} />
        <Stat label="Late" value={data.late} hint="Past the promised date" href="/admin/shipments?late=1" />
        <Stat label="Failed attempts today" value={data.failedToday} />
        <Stat label="Cash with couriers" value={egp(data.cashWithCouriers)} hint="On runs still out" />
        <Stat label="Trips on the road" value={data.tripsOnTheRoad} />
        <Stat label="On hold" value={data.byStatus.ON_HOLD ?? 0} hint="Waiting for merchants" href="/admin/shipments?status=ON_HOLD" />
      </div>
      <Card title="Parcels by status">
        <div className="flex flex-wrap gap-2">
          {SHIPMENT_STATUSES.map((s) => (
            <Link key={s} href={`/admin/shipments?status=${s}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200 hover:bg-slate-100">
              <StatusBadge status={s} />
              <span className="text-sm font-bold tabular-nums">{data.byStatus[s] ?? 0}</span>
            </Link>
          ))}
        </div>
      </Card>
      <Card title="Hubs">
        <Table head={['Code', 'Name', 'At hub', 'On hold', '']}>
          {data.hubs.map((h) => (
            <tr key={h.id}>
              <Td className="font-mono font-semibold">{h.code}</Td>
              <Td>
                {h.name}
                {h.isSorting && <span className="ml-2 text-xs text-brand-700">sorting</span>}
              </Td>
              <Td className="tabular-nums">{h.atHub}</Td>
              <Td className="tabular-nums">{h.onHold}</Td>
              <Td>
                <Link href={`/hub?hubId=${h.id}`} className="font-semibold text-brand-700">Open hub</Link>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

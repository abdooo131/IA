'use client';
import Link from 'next/link';
import { SHIPMENT_STATUSES } from '@shiply/shared';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { StatCard } from '@/components/StatCard';
import { Alert, Badge, Card, Loading, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

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
  hubs: { id: string; code: string; name: string; isSorting: boolean; parentId: string | null; atHub: number; onHold: number }[];
}
type Day = { date: string; entered: number; delivered: number; returned: number; failed: number };

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function AdminDashboard() {
  const t = useT();
  const { data, error, loading } = useLoad<Dashboard>('/admin/dashboard');
  const trend = useLoad<Day[]>('/admin/trend?days=14');
  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const n = (v: number) => String(v);
  const onHold = data.byStatus.ON_HOLD ?? 0;
  const code = (id: string | null) => data.hubs.find((h) => h.id === id)?.code ?? '';
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('Admin')} title={t('Dashboard')} subtitle={t('Today, {date}', { date: shortDate(data.today) })} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon="new" tone="new" label={t('Entered today')} value={n(data.enteredToday)} hint={t('Picked up or dropped off')} />
        <StatCard icon="delivered" tone="delivered" label={t('Delivered today')} value={n(data.deliveredToday)} />
        <StatCard icon="schedule" tone="heading-to-customer" label={t('Due today')} value={n(data.dueToday)} hint={t('{count} delivered on time', { count: data.deliveredOnTime })} />
        <Link href="/admin/shipments?late=1" className="block hover:opacity-90">
          <StatCard icon="alert" tone="needs-action" label={t('Late')} value={n(data.late)} hint={t('Past the promised date')} alert={data.late > 0} />
        </Link>
        <StatCard icon="returns" tone="needs-action" label={t('Failed attempts today')} value={n(data.failedToday)} />
        <StatCard icon="cash" tone="primary" label={t('Cash with couriers')} value={egp(data.cashWithCouriers)} hint={t('On runs still out')} />
        <StatCard icon="route" tone="in-progress" label={t('Trips on the road')} value={n(data.tripsOnTheRoad)} />
        <Link href="/admin/shipments?status=ON_HOLD" className="block hover:opacity-90">
          <StatCard icon="alert" tone="needs-action" label={t('On hold')} value={n(onHold)} hint={t('Waiting for merchants')} alert={onHold > 0} />
        </Link>
      </div>

      <Card title={t('Last 14 days')}>
        {!trend.data ? <Loading /> : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-caption font-semibold text-text-muted">{t('Parcels entering the network per day')}</p>
              <ColumnChart
                title={t('Parcels entering the network per day')}
                valueLabel={t('parcels')}
                columns={trend.data.map((d) => ({ key: d.date, label: ddmm(d.date), value: d.entered, detail: `${ddmm(d.date)}: ${d.entered}` }))}
              />
            </div>
            <div>
              <p className="mb-3 text-caption font-semibold text-text-muted">{t('Delivered per day')}</p>
              <ColumnChart
                title={t('Delivered per day')}
                valueLabel={t('parcels')}
                columns={trend.data.map((d) => ({ key: d.date, label: ddmm(d.date), value: d.delivered, detail: `${ddmm(d.date)}: ${d.delivered}` }))}
              />
            </div>
          </div>
        )}
      </Card>

      <Card title={t('Parcels by status')}>
        <div className="flex flex-wrap gap-2">
          {SHIPMENT_STATUSES.map((s) => (
            <Link key={s} href={`/admin/shipments?status=${s}`} className="flex items-center gap-2 rounded-md bg-surface-raised px-3 py-2 ring-1 ring-line hover:bg-selected-bg">
              <StatusBadge status={s} />
              <span className="tabular ltr-iso text-body-sm font-bold">{data.byStatus[s] ?? 0}</span>
            </Link>
          ))}
        </div>
      </Card>

      <Card title={t('Sorting facilities and last mile hubs')}>
        <Table head={[t('Code'), t('Name'), t('Type'), t('Fed by'), t('In the building'), t('On hold'), '']}>
          {data.hubs.map((h) => (
            <tr key={h.id}>
              <Td className="ltr-iso font-bold">{h.code}</Td>
              <Td>{h.name}</Td>
              <Td>{h.isSorting ? <Badge tone="blue">{t('Sorting facility')}</Badge> : <span className="text-text-muted">{t('Last mile hub')}</span>}</Td>
              <Td className="ltr-iso">{code(h.parentId)}</Td>
              <Td className="tabular">{h.atHub}</Td>
              <Td className="tabular">{h.onHold > 0 ? <Badge tone="amber">{h.onHold}</Badge> : 0}</Td>
              <Td>
                <Link href={`/hub?hubId=${h.id}`} className="font-bold text-link">{t('Open')}</Link>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

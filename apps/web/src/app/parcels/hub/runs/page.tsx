'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useHub } from '@/parcels/components/HubContext';
import { StatCard } from '@/parcels/components/StatCard';
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHeader, Select, Table, Td } from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

type Run = { id: string; code: string; courierName: string; status: string; total: number; pending: number; done: number; failed: number; failedNotBack: number; cashCollected: number; cashReceived: number | null };

export default function RunsPage() {
  const hub = useHub();
  const t = useT();
  const router = useRouter();
  const runs = useLoad<Run[]>(`/hubs/${hub.id}/runs`);
  const couriers = useLoad<{ id: string; name: string }[]>(`/hubs/${hub.id}/couriers`);
  const [courierId, setCourierId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const run = await api(`/hubs/${hub.id}/runs`, { body: { courierId } });
      router.push(`/parcels/hub/runs/${run.id}`);
    } catch (e) {
      setError(t(errorMessage(e)));
    }
  };

  const list = runs.data ?? [];
  const out = list.filter((r) => r.status === 'OUT');
  const statusTone = (s: string) => (s === 'LOADING' ? 'amber' : s === 'OUT' ? 'blue' : 'green');
  const statusText = (s: string) => (s === 'LOADING' ? t('Loading') : s === 'OUT' ? t('On the road') : t('Closed'));

  return (
    <>
      <PageHeader
        eyebrow={hub.isSorting ? t('Sorting facility') : t('Last mile hub')}
        title={`${t('Courier runs')} · ${hub.name}`}
        subtitle={hub.isSorting ? t('First mile couriers hand returns back to merchants from the return shelf.') : t('One run is one courier for the day: deliveries to consumers and any returns.')}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('Couriers on the road')} value={String(out.length)} icon="courier" tone="heading-to-customer" />
        <StatCard label={t('Stops left')} value={String(out.reduce((n, r) => n + r.pending, 0))} icon="route" tone="in-progress" />
        <StatCard label={t('Failed, not back yet')} value={String(out.reduce((n, r) => n + r.failedNotBack, 0))} icon="alert" tone="needs-action" alert={out.some((r) => r.failedNotBack > 0)} />
        <StatCard label={t('Cash with couriers')} value={egp(out.reduce((n, r) => n + r.cashCollected, 0))} icon="cash" tone="delivered" />
      </div>
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Card title={t('Start loading a run')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label={t('Courier')} className="sm:w-80">
            <Select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
              <option value="">{t('Choose a courier')}</option>
              {couriers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Button disabled={!courierId} onClick={() => void create()}>{t('New run')}</Button>
        </div>
      </Card>
      <Card title={t('Today')} className="mt-4">
        {!runs.data ? <Loading /> : list.length === 0 ? <Empty>{t('No runs today.')}</Empty> : (
          <Table head={[t('Run'), t('Courier'), t('Status'), t('Parcels'), t('Done'), t('Failed'), t('Cash collected'), '']}>
            {list.map((r) => (
              <tr key={r.id}>
                <Td><span className="ltr-iso font-mono font-bold">{r.code}</span></Td>
                <Td>{r.courierName}</Td>
                <Td><Badge tone={statusTone(r.status)}>{statusText(r.status)}</Badge></Td>
                <Td className="tabular">{r.total}</Td>
                <Td className="tabular">{r.done}</Td>
                <Td className="tabular">{r.failed}{r.failedNotBack > 0 && <span className="text-status-needs-action"> ({t('{n} not back', { n: r.failedNotBack })})</span>}</Td>
                <Td className="tabular">{egp(r.cashCollected)}</Td>
                <Td><Link className="font-bold text-link" href={`/parcels/hub/runs/${r.id}`}>{t('Open')}</Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

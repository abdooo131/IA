'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useHub } from '@/components/HubContext';
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

type Run = { id: string; code: string; courierName: string; status: string; total: number; pending: number; done: number; failed: number; failedNotBack: number; cashCollected: number; cashReceived: number | null };

export default function RunsPage() {
  const hub = useHub();
  const router = useRouter();
  const runs = useLoad<Run[]>(`/hubs/${hub.id}/runs`);
  const couriers = useLoad<{ id: string; name: string }[]>(`/hubs/${hub.id}/couriers`);
  const [courierId, setCourierId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const run = await api(`/hubs/${hub.id}/runs`, { body: { courierId } });
      router.push(`/hub/runs/${run.id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="Courier runs" subtitle="A run is one courier's parcels for the day: deliveries to customers and returns to merchants." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Card title="Start loading a run">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Courier" className="sm:w-72">
            <Select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
              <option value="">Choose a courier</option>
              {couriers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Button disabled={!courierId} onClick={() => void create()}>New run</Button>
        </div>
      </Card>
      <Card title="Today" className="mt-4">
        {!runs.data ? <Loading /> : runs.data.length === 0 ? <Empty>No runs today.</Empty> : (
          <Table head={['Run', 'Courier', 'Status', 'Parcels', 'Done', 'Failed', 'Cash collected', '']}>
            {runs.data.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono font-semibold">{r.code}</Td>
                <Td>{r.courierName}</Td>
                <Td><Badge tone={r.status === 'LOADING' ? 'amber' : r.status === 'OUT' ? 'blue' : 'green'}>{r.status === 'OUT' ? 'On the road' : r.status.toLowerCase()}</Badge></Td>
                <Td>{r.total}</Td>
                <Td>{r.done}</Td>
                <Td>{r.failed}{r.failedNotBack > 0 && <span className="text-rose-700"> ({r.failedNotBack} not back)</span>}</Td>
                <Td>{egp(r.cashCollected)}</Td>
                <Td><Link className="font-semibold text-brand-700" href={`/hub/runs/${r.id}`}>Open</Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

'use client';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, shortDate, todayCairo } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

interface Pickup {
  id: string;
  code: string;
  date: string;
  status: 'REQUESTED' | 'ASSIGNED' | 'COLLECTED' | 'RECEIVED' | 'CANCELLED';
  expectedCount: number;
  notes: string;
  collectedAt: string | null;
  receivedAt: string | null;
}

const STATUS: Record<Pickup['status'], { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' }> = {
  REQUESTED: { label: 'Requested', tone: 'slate' },
  ASSIGNED: { label: 'Courier assigned', tone: 'blue' },
  COLLECTED: { label: 'Collected', tone: 'amber' },
  RECEIVED: { label: 'At our hub', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};

export default function PickupsPage() {
  const { data, error, loading, reload } = useLoad<Pickup[]>('/merchant/pickups');
  const [date, setDate] = useState(todayCairo());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const p = await api<Pickup>('/merchant/pickups', { body: { date, notes } });
      setMsg({ tone: 'success', text: `Pickup ${p.code} requested for ${shortDate(p.date)} with ${p.expectedCount} parcels` });
      setNotes('');
      await reload();
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (p: Pickup) => {
    if (!window.confirm(`Cancel pickup ${p.code}?`)) return;
    try {
      await api(`/merchant/pickups/${p.id}/cancel`, { body: {} });
      await reload();
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Pickups" subtitle="Ask a courier to collect your new parcels" />
      <Card title="Request a pickup">
        {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        <form onSubmit={request} className="grid gap-4 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <Field label="Day">
            <Input type="date" required min={todayCairo()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Notes for the courier">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate, floor, best time…" />
          </Field>
          <Button type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Request pickup'}</Button>
        </form>
        <p className="mt-3 text-xs text-slate-500">All parcels you created and we have not collected yet will be picked up. Parcels collected before the daily cutoff are promised for the next working day.</p>
      </Card>
      <Card title="Your pickups">
        {error && <Alert>{error}</Alert>}
        {loading && !data ? (
          <Loading />
        ) : !data || data.length === 0 ? (
          <Empty>No pickups yet.</Empty>
        ) : (
          <Table head={['Code', 'Day', 'Status', 'Parcels', 'Collected', '']}>
            {data.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono font-semibold">{p.code}</Td>
                <Td>{shortDate(p.date)}</Td>
                <Td><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge></Td>
                <Td className="tabular-nums">{p.expectedCount}</Td>
                <Td>{dateTime(p.collectedAt)}</Td>
                <Td>
                  {(p.status === 'REQUESTED' || p.status === 'ASSIGNED') && (
                    <Button tone="ghost" onClick={() => void cancel(p)}>Cancel</Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

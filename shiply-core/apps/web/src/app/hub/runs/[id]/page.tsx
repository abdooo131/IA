'use client';
import { egpToPiastres, FAIL_REASONS, type FailReason } from '@shiply/shared';
import Link from 'next/link';
import { use, useState } from 'react';
import { useHub } from '@/components/HubContext';
import { ScanBox } from '@/components/ScanBox';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

type Item = { id: string; direction: string; result: string; failReason: string | null; codCollected: number; backAtHub: boolean; shipment: { trackingNumber: string; customerName: string; address: string; codAmount: number; status: string } };
type Run = { id: string; code: string; status: string; cashExpected: number; cashReceived: number | null; items: Item[] };

const RESULT: Record<string, { text: string; tone: 'slate' | 'green' | 'red' | 'amber' }> = {
  PENDING: { text: 'Not done yet', tone: 'slate' },
  DELIVERED: { text: 'Delivered', tone: 'green' },
  RETURNED: { text: 'Returned to merchant', tone: 'green' },
  FAILED: { text: 'Failed', tone: 'red' },
};

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const hub = useHub();
  const run = useLoad<Run>(`/hubs/${hub.id}/runs/${id}`);
  const [cash, setCash] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'warning'; text: string } | null>(null);

  if (!run.data) return run.error ? <Alert>{run.error}</Alert> : <Loading />;
  const r = run.data;
  const collected = r.items.reduce((n, i) => n + i.codCollected, 0);
  const notBack = r.items.filter((i) => i.result === 'PENDING' || (i.result === 'FAILED' && !i.backAtHub));

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      await run.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: errorMessage(e) });
    }
  };

  const close = () =>
    act(async () => {
      const value = egpToPiastres(cash || '0');
      if (value === null) throw new Error('Type the cash amount in EGP, for example 1250 or 1250.50');
      const res = await api(`/hubs/${hub.id}/runs/${id}/close`, { body: { cashReceived: value } });
      setMsg(res.difference === 0
        ? { tone: 'success', text: 'Run closed. Cash matches.' }
        : { tone: 'warning', text: `Run closed. Cash difference ${egp(res.difference)} recorded against the courier.` });
    });

  return (
    <>
      <PageHeader
        title={`Run ${r.code}`}
        subtitle={<Link href="/hub/runs" className="text-brand-700">All runs</Link>}
        actions={<Badge tone={r.status === 'LOADING' ? 'amber' : r.status === 'OUT' ? 'blue' : 'green'}>{r.status === 'OUT' ? 'On the road' : r.status.toLowerCase()}</Badge>}
      />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      {r.status === 'LOADING' && (
        <Card title="Load parcels" actions={<Button tone="success" disabled={r.items.length === 0} onClick={() => void act(() => api(`/hubs/${hub.id}/runs/${id}/start`, { body: {} }))}>Courier is leaving now</Button>}>
          <ScanBox
            label="Scan parcels ready for delivery or return"
            onScan={async (code) => {
              const res = await api(`/hubs/${hub.id}/runs/${id}/add`, { body: { code } });
              void run.reload();
              return res.message;
            }}
          />
        </Card>
      )}

      {r.status === 'OUT' && (
        <Card title="End of day">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p>1. Scan every failed or undelivered parcel on the <Link href="/hub" className="font-semibold text-brand-700">Receive</Link> page.</p>
              <p>2. Count the cash and type what the courier handed over.</p>
              {notBack.length > 0 && <Alert tone="warning">Still with the courier: {notBack.map((i) => i.shipment.trackingNumber).join(', ')}</Alert>}
            </div>
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Cash the courier should have: <strong className="text-lg">{egp(collected)}</strong></div>
              <Field label="Cash received (EGP)"><Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" /></Field>
              <Button className="w-full" disabled={notBack.length > 0} onClick={() => void close()}>Close run</Button>
            </div>
          </div>
        </Card>
      )}

      {r.status === 'CLOSED' && (
        <Card title="Closed">
          <p className="text-sm">Expected {egp(r.cashExpected)}, received {egp(r.cashReceived ?? 0)}.{(r.cashReceived ?? 0) !== r.cashExpected && <strong className="text-rose-700"> Difference {egp((r.cashReceived ?? 0) - r.cashExpected)}.</strong>}</p>
        </Card>
      )}

      <Card title={`Parcels (${r.items.length})`} className="mt-4">
        <Table head={['Parcel', 'Type', 'Customer', 'COD', 'Result', 'Collected', '']}>
          {r.items.map((i) => (
            <tr key={i.id}>
              <Td className="font-mono">{i.shipment.trackingNumber}</Td>
              <Td>{i.direction === 'RETURN' ? <Badge tone="red">Return</Badge> : 'Delivery'}</Td>
              <Td>{i.shipment.customerName}</Td>
              <Td>{egp(i.shipment.codAmount)}</Td>
              <Td>
                <Badge tone={RESULT[i.result]?.tone ?? 'slate'}>{RESULT[i.result]?.text ?? i.result}</Badge>
                {i.failReason && <span className="ml-1 text-xs text-slate-500">{FAIL_REASONS[i.failReason as FailReason]?.label ?? 'Not attempted'}</span>}
                {i.result === 'FAILED' && (i.backAtHub ? <span className="ml-1 text-xs text-emerald-700">back in hub</span> : <span className="ml-1 text-xs text-rose-700">not back yet</span>)}
              </Td>
              <Td>{egp(i.codCollected)}</Td>
              <Td>{r.status === 'LOADING' && <Button tone="ghost" onClick={() => void act(() => api(`/hubs/${hub.id}/runs/${id}/remove`, { body: { code: i.shipment.trackingNumber } }))}>Remove</Button>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

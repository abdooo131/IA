'use client';
import { FAIL_REASON_CODES, FAIL_REASONS, egpToPiastres } from '@shiply/shared';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

type Stop = {
  id: string;
  direction: 'FORWARD' | 'RETURN';
  result: string;
  codCollected: number;
  shipment: {
    trackingNumber: string; customerName: string; customerPhone: string; address: string; governorateCode: string;
    codAmount: number; allowOpen: boolean; notes: string; description: string; attempts: number;
    merchant: { name: string; phone: string; pickupAddress: string };
  };
};
type Run = { id: string; code: string; status: string; cashCollected: number; items: Stop[] };

function StopCard({ stop, onDone }: { stop: Stop; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'deliver' | 'fail'>('idle');
  const [cash, setCash] = useState('');
  const [recipient, setRecipient] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = stop.shipment;
  const isReturn = stop.direction === 'RETURN';
  const who = isReturn ? s.merchant.name : s.customerName;
  const phone = isReturn ? s.merchant.phone : s.customerPhone;
  const address = isReturn ? s.merchant.pickupAddress : s.address;

  const send = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/courier/stops/${stop.id}/${path}`, { body });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const done = stop.result !== 'PENDING';
  return (
    <Card className={done ? 'opacity-70' : ''}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">{who}</div>
          <div className="font-mono text-xs text-slate-500">{s.trackingNumber}</div>
        </div>
        {isReturn ? <Badge tone="red">Return to merchant</Badge> : s.attempts > 0 ? <Badge tone="amber">Attempt {s.attempts + 1}</Badge> : null}
      </div>
      <p className="mt-2 text-sm">{address}</p>
      {!isReturn && (s.description || s.notes) && <p className="mt-1 text-xs text-slate-600">{[s.description, s.notes].filter(Boolean).join(' · ')}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`tel:${phone}`} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold">Call</a>
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold">Map</a>
      </div>
      {!isReturn && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm">
          {s.codAmount > 0 ? <>Collect <strong className="text-lg">{egp(s.codAmount)}</strong></> : 'Nothing to collect'}
          {s.allowOpen && <span className="ml-2 text-xs">Customer may open the parcel</span>}
        </div>
      )}

      {done ? (
        <div className="mt-3"><Badge tone={stop.result === 'FAILED' ? 'red' : 'green'}>{stop.result === 'FAILED' ? 'Failed, bring it back to the hub' : stop.result === 'RETURNED' ? 'Returned' : `Delivered, ${egp(stop.codCollected)} collected`}</Badge></div>
      ) : (
        <div className="mt-4 space-y-3">
          {error && <Alert>{error}</Alert>}
          {mode === 'idle' && (
            <div className="grid grid-cols-2 gap-2">
              <Button tone="success" className="min-h-12" onClick={() => { setMode('deliver'); setCash(isReturn ? '0' : String(s.codAmount / 100)); }}>{isReturn ? 'Handed back' : 'Delivered'}</Button>
              <Button tone="secondary" className="min-h-12" onClick={() => setMode('fail')}>Could not</Button>
            </div>
          )}
          {mode === 'deliver' && (
            <>
              {!isReturn && <Field label="Cash collected (EGP)" hint="Must be the full amount"><Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /></Field>}
              <Field label="Received by"><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Name of the person" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Button tone="secondary" onClick={() => setMode('idle')}>Back</Button>
                <Button
                  tone="success"
                  disabled={busy}
                  onClick={() => {
                    const value = isReturn ? 0 : egpToPiastres(cash || '0');
                    if (value === null) return setError('Type the amount in EGP');
                    void send('deliver', { codCollected: value, recipient });
                  }}
                >
                  Confirm
                </Button>
              </div>
            </>
          )}
          {mode === 'fail' && (
            <>
              <Field label="What happened?">
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose a reason</option>
                  {FAIL_REASON_CODES.map((c) => <option key={c} value={c}>{FAIL_REASONS[c].label}</option>)}
                </Select>
              </Field>
              <Field label="Note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Button tone="secondary" onClick={() => setMode('idle')}>Back</Button>
                <Button tone="danger" disabled={busy || !reason} onClick={() => void send('fail', { reason, note })}>Record attempt</Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export default function CourierRunPage() {
  const run = useLoad<Run | null>('/courier/run');
  if (run.loading && !run.data) return <Loading />;
  const r = run.data;
  if (!r) return (<><PageHeader title="My run" /><Empty>You have no run right now. The hub will load one for you.</Empty></>);
  const pending = r.items.filter((i) => i.result === 'PENDING').length;
  return (
    <>
      <PageHeader title={`Run ${r.code}`} subtitle={r.status === 'LOADING' ? 'The hub is still loading your parcels.' : `${pending} of ${r.items.length} stops left`} />
      <div className="mb-4 rounded-xl bg-brand-600 p-4 text-white">
        <div className="text-xs uppercase tracking-wide opacity-80">Cash you are carrying</div>
        <div className="text-2xl font-bold">{egp(r.cashCollected)}</div>
      </div>
      {r.status === 'LOADING' ? <Empty>Wait until the hub marks the run as leaving.</Empty> : (
        <div className="space-y-3">
          {[...r.items].sort((a, b) => Number(a.result !== 'PENDING') - Number(b.result !== 'PENDING')).map((i) => <StopCard key={i.id} stop={i} onDone={() => void run.reload()} />)}
        </div>
      )}
    </>
  );
}

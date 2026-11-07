'use client';
import { useState } from 'react';
import { useHub } from '@/components/HubContext';
import { ScanBox } from '@/components/ScanBox';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

type Trip = { id: string; code: string; originHubId: string; destinationHubId: string; vehicle: string; driverName: string; status: string; departedAt: string | null; outgoing: boolean; bags: { id: string; code: string; status: string }[] };
type Hub = { id: string; code: string; name: string };

export default function TripsPage() {
  const hub = useHub();
  const trips = useLoad<Trip[]>(`/hubs/${hub.id}/trips`);
  const hubs = useLoad<Hub[]>('/reference/hubs');
  const bags = useLoad<{ id: string; code: string; status: string; originHubId: string; destinationHubId: string; parcels: number; tripId: string | null }[]>(`/hubs/${hub.id}/bags`);
  const [form, setForm] = useState({ destinationHubId: '', vehicle: '', driverName: '' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const code = (id: string) => hubs.data?.find((h) => h.id === id)?.code ?? '';

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await trips.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: errorMessage(e) });
    }
  };

  const outgoing = (trips.data ?? []).filter((t) => t.outgoing);
  const incoming = (trips.data ?? []).filter((t) => !t.outgoing);

  return (
    <>
      <PageHeader
        title={hub.isSorting ? `Outbound · ${hub.name}` : `Trips · ${hub.name}`}
        subtitle={hub.isSorting
          ? 'Outbound team: scan each sealed bag to take it over from sorting, then load it on the truck for its destination and mark the truck as leaving.'
          : 'A trip is one vehicle carrying sealed bags. Load bags by scanning them, then mark the trip as leaving.'}
      />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {hub.isSorting && (
        <Card title="Take over bags from sorting" className="mb-4">
          <ScanBox
            label="Sealed bag code"
            placeholder="BG00123"
            onScan={async (c) => {
              const r = await api(`/hubs/${hub.id}/outbound/accept`, { body: { code: c } });
              void bags.reload();
              return r.message;
            }}
          />
          {(bags.data ?? []).filter((b) => b.originHubId === hub.id && b.status !== 'OPEN').length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {(bags.data ?? []).filter((b) => b.originHubId === hub.id && b.status !== 'OPEN').map((b) => (
                <Badge key={b.id} tone={b.status === 'SEALED' ? 'amber' : 'green'}>{b.code} → {code(b.destinationHubId)} · {b.parcels} · {b.status === 'SEALED' ? 'waiting' : b.tripId ? 'loaded' : 'ready to load'}</Badge>
              ))}
            </div>
          )}
        </Card>
      )}
      <Card title="New trip">
        <form
          className="grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api(`/hubs/${hub.id}/trips`, { body: form }), 'Trip created. Scan its bags below.');
          }}
        >
          <Field label="Going to">
            <Select required value={form.destinationHubId} onChange={(e) => setForm({ ...form, destinationHubId: e.target.value })}>
              <option value="">Choose hub</option>
              {hubs.data?.filter((h) => h.id !== hub.id).map((h) => <option key={h.id} value={h.id}>{h.code} · {h.name}</option>)}
            </Select>
          </Field>
          <Field label="Vehicle plate"><Input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} /></Field>
          <Field label="Driver"><Input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} /></Field>
          <Button type="submit">Create trip</Button>
        </form>
      </Card>

      <h2 className="mb-3 mt-6 text-lg font-semibold">Leaving this hub</h2>
      {!trips.data ? <Loading /> : outgoing.length === 0 ? <Empty>No trips loading or on the road.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {outgoing.map((t) => (
            <Card key={t.id} title={<span className="font-mono">{t.code} → {code(t.destinationHubId)}</span>} actions={<Badge tone={t.status === 'LOADING' ? 'amber' : 'blue'}>{t.status === 'LOADING' ? 'Loading' : `Left ${dateTime(t.departedAt)}`}</Badge>}>
              <p className="mb-3 text-sm text-slate-600">{[t.vehicle, t.driverName].filter(Boolean).join(' · ') || 'No vehicle details'}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {t.bags.length === 0 ? <span className="text-sm text-slate-500">No bags loaded</span> : t.bags.map((b) => <Badge key={b.id}>{b.code}</Badge>)}
              </div>
              {t.status === 'LOADING' && (
                <>
                  <ScanBox
                    label="Scan a sealed bag to load it"
                    placeholder="BG00123"
                    onScan={async (c) => {
                      const r = await api(`/hubs/${hub.id}/trips/${t.id}/load`, { body: { code: c } });
                      void trips.reload();
                      void bags.reload();
                      return r.message;
                    }}
                  />
                  <Button className="mt-3 w-full" tone="success" disabled={t.bags.length === 0} onClick={() => void act(() => api(`/hubs/${hub.id}/trips/${t.id}/depart`, { body: {} }), `Trip ${t.code} departed`)}>
                    Truck is leaving now
                  </Button>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-6 text-lg font-semibold">Coming to this hub</h2>
      {incoming.length === 0 ? <Empty>No trips on the way here.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {incoming.map((t) => {
            const left = t.bags.filter((b) => b.status !== 'RECEIVED');
            return (
              <Card key={t.id} title={<span className="font-mono">{t.code} from {code(t.originHubId)}</span>} actions={<Badge tone="blue">Left {dateTime(t.departedAt)}</Badge>}>
                <p className="mb-2 text-sm">Bags still to receive: {left.length === 0 ? 'none' : left.map((b) => b.code).join(', ')}</p>
                <p className="mb-3 text-xs text-slate-500">{hub.isSorting ? 'Inbound team scans the bags on the Inbound page.' : 'Scan the bags on the Receive page.'} When something is missing, close the trip so the missing bags show up for follow up.</p>
                <Button
                  tone="secondary"
                  onClick={() =>
                    void act(async () => {
                      const r = await api(`/hubs/${hub.id}/trips/${t.id}/close`, { body: {} });
                      if (r.missing.length) throw new Error(`Trip closed. Missing bags: ${r.missing.join(', ')}`);
                    }, 'Trip closed, nothing missing')
                  }
                >
                  Close trip
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

'use client';
import { useState } from 'react';
import { useHub } from '@/components/HubContext';
import { ScanBox } from '@/components/ScanBox';
import { StatCard } from '@/components/StatCard';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { OutboundBags } from './OutboundBags';

type Trip = { id: string; code: string; originHubId: string; destinationHubId: string; vehicle: string; driverName: string; status: string; departedAt: string | null; outgoing: boolean; bags: { id: string; code: string; status: string }[] };
type Hub = { id: string; code: string; name: string };
type Bag = { id: string; code: string; status: string; originHubId: string; destinationHubId: string; parcels: number; tripId: string | null };

export default function OutboundPage() {
  const hub = useHub();
  const t = useT();
  const trips = useLoad<Trip[]>(`/hubs/${hub.id}/trips`);
  const hubs = useLoad<Hub[]>('/reference/hubs');
  const bags = useLoad<Bag[]>(`/hubs/${hub.id}/bags`);
  const [form, setForm] = useState({ destinationHubId: '', vehicle: '', driverName: '' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'warning'; text: string } | null>(null);
  const code = (id: string) => hubs.data?.find((h) => h.id === id)?.code ?? '';

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await Promise.all([trips.reload(), bags.reload()]);
    } catch (e) {
      setMsg({ tone: 'error', text: t(errorMessage(e)) });
    }
  };

  const mine = (bags.data ?? []).filter((b) => b.originHubId === hub.id && b.status !== 'OPEN');
  const openBags = mine.filter((b) => b.status === 'OPEN');
  const ready = mine.filter((b) => b.status === 'SEALED' && !b.tripId);
  const outgoing = (trips.data ?? []).filter((x) => x.outgoing);
  // Suggest the destination of the first bag ready to load.
  const suggested = ready[0]?.destinationHubId;

  return (
    <>
      <PageHeader
        eyebrow={hub.isSorting ? t('Sorting facility') : t('Last mile hub')}
        title={`${hub.isSorting ? t('Outbound') : t('Trips')} · ${hub.name}`}
        subtitle={hub.isSorting
          ? t('Outbound team: scan each parcel from its lane into its bag (this completes the handover from sorting), seal the bag, load it on the truck and mark the truck as leaving.')
          : t('A trip is one vehicle carrying sealed bags. Load bags by scanning them, then mark the trip as leaving.')}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={t('Open bags')} value={String(openBags.length)} icon="packaging" tone="in-progress" />
        <StatCard label={t('Sealed, ready to load')} value={String(ready.length)} icon="route" tone="heading-to-customer" alert={ready.length > 0} />
        <StatCard label={t('Trucks loading')} value={String(outgoing.filter((x) => x.status === 'LOADING').length)} icon="schedule" tone="in-progress" />
      </div>
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      {hub.isSorting && (
        <div className="mb-4">
          <OutboundBags onChange={() => void Promise.all([bags.reload(), trips.reload()])} />
        </div>
      )}

      <Card title={t('New truck')}>
        <form
          className="grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api(`/hubs/${hub.id}/trips`, { body: { ...form, destinationHubId: form.destinationHubId || suggested } }), t('Truck created. Scan its bags below.'));
          }}
        >
          <Field label={t('Going to')}>
            <Select required value={form.destinationHubId || suggested || ''} onChange={(e) => setForm({ ...form, destinationHubId: e.target.value })}>
              <option value="">{t('Choose')}</option>
              {hubs.data?.filter((h) => h.id !== hub.id).map((h) => <option key={h.id} value={h.id}>{h.code} · {h.name}</option>)}
            </Select>
          </Field>
          <Field label={t('Vehicle plate')}><Input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} /></Field>
          <Field label={t('Driver')}><Input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} /></Field>
          <Button type="submit">{t('Create truck')}</Button>
        </form>
      </Card>

      <h2 className="mb-3 mt-8 text-h3">{t('Leaving here')}</h2>
      {!trips.data ? <Loading /> : outgoing.length === 0 ? <Empty>{t('No trucks loading or on the road.')}</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {outgoing.map((tr) => (
            <Card
              key={tr.id}
              title={<span className="ltr-iso">{tr.code} → {code(tr.destinationHubId)}</span>}
              actions={<Badge tone={tr.status === 'LOADING' ? 'amber' : 'blue'}>{tr.status === 'LOADING' ? t('Loading') : `${t('Left')} ${dateTime(tr.departedAt)}`}</Badge>}
            >
              <p className="mb-3 text-body-sm text-text-muted">{[tr.vehicle, tr.driverName].filter(Boolean).join(' · ') || t('No vehicle details')}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {tr.bags.length === 0 ? <span className="text-body-sm text-text-muted">{t('No bags loaded')}</span> : tr.bags.map((b) => <Badge key={b.id}><span className="ltr-iso">{b.code}</span></Badge>)}
              </div>
              {tr.status === 'LOADING' && (
                <>
                  <ScanBox
                    size="md"
                    autoFocus={false}
                    label={t('Scan a bag to load it')}
                    placeholder="BG00123"
                    onScan={async (c) => {
                      const r = await api(`/hubs/${hub.id}/trips/${tr.id}/load`, { body: { code: c } });
                      void trips.reload();
                      void bags.reload();
                      return { big: r.bag, text: t('Loaded') };
                    }}
                  />
                  <Button className="mt-3 w-full min-h-12" tone="accent" disabled={tr.bags.length === 0} onClick={() => void act(() => api(`/hubs/${hub.id}/trips/${tr.id}/depart`, { body: {} }), t('Truck {code} left', { code: tr.code }))}>
                    {t('Truck is leaving now')}
                  </Button>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

    </>
  );
}

'use client';
import { FAIL_REASON_LABELS_AR, FAIL_REASONS, type FailReason } from '@shiply/shared';
import { useHub } from '@/components/HubContext';
import type { IconName } from '@/components/Icon';
import { ScanBox } from '@/components/ScanBox';
import { StatCard, type StatTone } from '@/components/StatCard';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { nextOutcome } from '@/lib/hub';
import { IncomingPallets } from './trips/Pallets';
import { useLocale, useT } from '@/lib/i18n';

type Row = { id: string; trackingNumber: string; merchant: string; customerName: string; governorateCode: string; codAmount: number; attempts: number; promisedDate: string | null; direction: string; holdReason: string | null; nextHub: string | null };
type OnHand = { hub: { isSorting: boolean }; groups: { key: string; title: string; hint: string; rows: Row[] }[] };

const LOOK: Record<string, { icon: IconName; tone: StatTone }> = {
  inbound: { icon: 'scan', tone: 'new' },
  sorted: { icon: 'packaging', tone: 'in-progress' },
  outbound: { icon: 'route', tone: 'heading-to-customer' },
  returnShelf: { icon: 'returns', tone: 'returning' },
  onRun: { icon: 'courier', tone: 'primary' },
  deliver: { icon: 'delivered', tone: 'delivered' },
  onHold: { icon: 'alert', tone: 'needs-action' },
  send: { icon: 'returns', tone: 'returning' },
  bagged: { icon: 'packaging', tone: 'in-progress' },
};

type Trip = { id: string; code: string; originHubId: string; departedAt: string | null; outgoing: boolean; vehicle: string; bags: { id: string; code: string; status: string }[] };

/** Trucks on their way here: which bags to expect, and closing a truck with bags missing. */
function IncomingTrucks({ hubId, onChange }: { hubId: string; onChange: () => void }) {
  const t = useT();
  const trips = useLoad<Trip[]>(`/hubs/${hubId}/trips`);
  const hubs = useLoad<{ id: string; code: string }[]>('/reference/hubs');
  const [msg, setMsg] = useState<string | null>(null);
  const incoming = (trips.data ?? []).filter((x) => !x.outgoing);
  if (incoming.length === 0) return null;
  return (
    <Card title={t('Trucks coming here')} className="mt-4">
      {msg && <div className="mb-3"><Alert tone="warning">{msg}</Alert></div>}
      <ul className="divide-y divide-line">
        {incoming.map((tr) => {
          const left = tr.bags.filter((b) => b.status !== 'RECEIVED');
          return (
            <li key={tr.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-bold"><span className="ltr-iso">{tr.code} ← {hubs.data?.find((h) => h.id === tr.originHubId)?.code}</span> <span className="text-caption text-text-muted">{t('Left')} {dateTime(tr.departedAt)}</span></p>
                <p className="text-caption text-text-muted">{t('Bags still to receive')}: <span className="ltr-iso font-bold text-text">{left.map((b) => b.code).join(', ') || '0'}</span></p>
              </div>
              <Button tone="secondary" onClick={async () => {
                try {
                  const r = await api(`/hubs/${hubId}/trips/${tr.id}/close`, { body: {} });
                  setMsg(r.missing.length ? `${t('Truck closed. Missing bags')}: ${r.missing.join(', ')}` : t('Truck closed, nothing missing'));
                  await trips.reload();
                  onChange();
                } catch (e) {
                  setMsg(t(errorMessage(e)));
                }
              }}>{t('Close truck')}</Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

type Arrival = { id: string; code: string; originHubId: string; receivedAt: string; left: { trackingNumber: string; customerName: string }[] };

/** Bags opened here whose parcels are still being scanned. Closing one marks the rest lost. */
function OpenBags({ hubId, onChange }: { hubId: string; onChange: () => void }) {
  const t = useT();
  const arrivals = useLoad<Arrival[]>(`/hubs/${hubId}/arrivals`);
  const [msg, setMsg] = useState<{ tone: 'warning' | 'success' | 'error'; text: string } | null>(null);
  const list = arrivals.data ?? [];
  if (list.length === 0 && !msg) return null;
  const close = async (a: Arrival) => {
    if (a.left.length > 0 && !window.confirm(t('{n} parcels were not scanned. Close the bag and mark them lost?', { n: a.left.length }))) return;
    try {
      const r = await api(`/hubs/${hubId}/bags/${a.id}/check`, { body: {} });
      setMsg(r.missing.length ? { tone: 'warning', text: `${t('Bag closed. Marked lost')}: ${r.missing.join(', ')}` } : { tone: 'success', text: t('Bag closed, nothing missing') });
      await arrivals.reload();
      onChange();
    } catch (e) {
      setMsg({ tone: 'error', text: t(errorMessage(e)) });
    }
  };
  return (
    <Card title={t('Bags being checked')} className="mt-4">
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <ul className="divide-y divide-line">
        {list.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-bold"><span className="ltr-iso">{a.code}</span> <span className="text-caption text-text-muted">{t('opened')} {dateTime(a.receivedAt)}</span></p>
              <p className="text-caption text-text-muted">
                {a.left.length === 0 ? t('All parcels scanned') : <>{t('Not scanned yet')}: <span className="ltr-iso font-bold text-status-needs-action">{a.left.map((x) => x.trackingNumber).join(', ')}</span></>}
              </p>
            </div>
            <Button tone={a.left.length ? 'danger' : 'secondary'} onClick={() => void close(a)}>{t('Close bag')}</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function InboundPage() {
  const hub = useHub();
  const t = useT();
  const locale = useLocale();
  const { data, reload } = useLoad<OnHand>(`/hubs/${hub.id}/on-hand`);
  const [arrivalsKey, setArrivalsKey] = useState(0);
  const facility = hub.isSorting;
  const reason = (r: string | null) => (r ? (locale === 'ar' ? FAIL_REASON_LABELS_AR[r as FailReason] : FAIL_REASONS[r as FailReason]?.label) ?? r : '');

  return (
    <>
      <PageHeader
        eyebrow={facility ? t('Sorting facility') : t('Last mile hub')}
        title={`${facility ? t('Inbound') : t('Receive')} · ${hub.name}`}
        subtitle={facility ? t('Inbound team: scan every parcel and bag that arrives. The screen shows where it goes next; hand it to the sorting team.') : t('Scan line haul bags and parcels couriers bring back. Parcels for delivery stay here; returns go back to the sorting facility.')}
      />
      {data && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {data.groups.map((g) => (
            <StatCard key={g.key} label={t(g.title)} value={String(g.rows.length)} icon={LOOK[g.key]?.icon} tone={LOOK[g.key]?.tone} alert={g.key === 'onHold' && g.rows.length > 0} />
          ))}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card title={t('Scan parcels in')}>
          <ScanBox
            label={t('Parcel tracking number')}
            onScan={async (code) => {
              const r = await api(`/hubs/${hub.id}/inbound`, { body: { code } });
              void reload();
              setArrivalsKey((k) => k + 1);
              return nextOutcome(r.next, facility, t, r.message, r.warning);
            }}
          />
        </Card>
        <Card title={t('Receive a whole bag')}>
          <ScanBox
            size="md"
            label={t('Bag code from a line haul trip')}
            placeholder="BG00123"
            autoFocus={false}
            onScan={async (code) => {
              const r = await api(`/hubs/${hub.id}/receive-bag`, { body: { code } });
              void reload();
              setArrivalsKey((k) => k + 1);
              return { big: r.bag, text: t('Bag opened. Scan each of its {n} parcels', { n: r.expected }), warn: r.warning ? t(r.warning) : undefined };
            }}
          />
        </Card>
      </div>

      <OpenBags key={arrivalsKey} hubId={hub.id} onChange={() => void reload()} />
      <IncomingPallets />
      <IncomingTrucks hubId={hub.id} onChange={() => void reload()} />

      <h2 className="mb-3 mt-8 text-h3">{t('In this building now')}</h2>
      {!data ? <Loading /> : (
        <div className="space-y-4">
          {data.groups.filter((g) => g.rows.length > 0).length === 0 && <Empty>{t('Nothing here')}</Empty>}
          {data.groups.filter((g) => g.rows.length > 0).map((g) => (
            <Card key={g.key} title={<span className="flex items-center gap-2">{t(g.title)} <Badge tone="blue">{g.rows.length}</Badge></span>}>
              <p className="-mt-2 mb-3 text-caption text-text-muted">{t(g.hint)}</p>
              <Table head={[t('Parcel'), t('Merchant'), t('Customer'), t('Next'), t('COD'), t('Promised'), g.key === 'onHold' ? t('Reason') : t('Attempts')]}>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <Td><span className="ltr-iso font-mono">{r.trackingNumber}</span> {r.direction === 'RETURN' && <Badge tone="red">{t('return')}</Badge>}</Td>
                    <Td>{r.merchant}</Td>
                    <Td>{r.customerName}</Td>
                    <Td className="font-bold"><span className="ltr-iso">{r.nextHub ?? (r.direction === 'RETURN' ? t('Merchant') : r.governorateCode)}</span></Td>
                    <Td className="tabular">{egp(r.codAmount)}</Td>
                    <Td>{shortDate(r.promisedDate)}</Td>
                    <Td>{g.key === 'onHold' ? reason(r.holdReason) : r.attempts}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

'use client';

import { Button, Card, ErrorBox, Money, PageHeader, Spinner, StatusBadge, useApp, useAsync } from '@shiply/ui';
import { OrderStatus } from '@shiply/shared';
import Link from 'next/link';
import { useState } from 'react';
import { BulkResult, BulkResultBox, DriverSelect, useDrivers, useRunSheet } from '../shared';

interface StopOrder {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  codAmount: number;
  createdAt: string;
  pickupDriver: { id: string; fullName: string } | null;
}
interface Stop {
  key: string;
  merchant: { id: string; nameEn: string; nameAr: string };
  location: { name: string; area: string; addressLine: string; contactPhone: string | null } | null;
  orders: StopOrder[];
}

export default function PickupsPage() {
  const { api, t, lang } = useApp();
  const queue = useAsync(() => api.get<Stop[]>('/ops/pickups'), []);
  const drivers = useDrivers('PICKUP');
  const runSheet = useRunSheet();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: object) {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<BulkResult>(path, body));
      setSelected(new Set());
      queue.reload();
      drivers.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const toggleStop = (s: Stop) => {
    const ids = s.orders.map((o) => o.id);
    const all = ids.every((id) => selected.has(id));
    const n = new Set(selected);
    ids.forEach((id) => (all ? n.delete(id) : n.add(id)));
    setSelected(n);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t.pickups} subtitle={t.pickupsSubtitle} />

      <Card title={t.drivers}>
        <div className="flex flex-wrap gap-2">
          {(drivers.data ?? []).filter((d) => d.status === 'ACTIVE').map((d) => (
            <button key={d.id} type="button" onClick={() => runSheet(d)} className="rounded-lg px-3 py-2 text-start text-sm ring-1 ring-inset ring-line hover:bg-paper">
              <div className="font-medium">{d.fullName}</div>
              <div className="text-xs text-muted">{d.openPickups} {t.parcels} · {t.runSheet}</div>
            </button>
          ))}
        </div>
      </Card>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <span className="text-sm font-medium">{selected.size} {t.selected}</span>
        <DriverSelect drivers={drivers.data ?? []} value={driverId} onChange={setDriverId} />
        <Button disabled={!selected.size || !driverId || busy} onClick={() => run('/ops/pickups/assign', { ids: [...selected], driverId })}>{t.assignPickup}</Button>
        <Button variant="dark" disabled={!selected.size || busy} onClick={() => run('/ops/pickups/picked-up', { ids: [...selected] })}>{t.markPickedUp}</Button>
      </div>
      <BulkResultBox result={result} onClose={() => setResult(null)} />
      <ErrorBox error={error} />

      {queue.loading && !queue.data ? (
        <Spinner />
      ) : queue.error ? (
        <ErrorBox error={queue.error} />
      ) : queue.data!.length === 0 ? (
        <p className="text-sm text-muted">{t.none}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="pickup-stops">
          {queue.data!.map((s) => {
            const ids = s.orders.map((o) => o.id);
            const all = ids.every((id) => selected.has(id));
            return (
              <section key={s.key} className="rounded-xl border border-line bg-surface shadow-card">
                <header className="flex items-start gap-3 border-b border-line px-4 py-3">
                  <input type="checkbox" className="mt-1" checked={all} onChange={() => toggleStop(s)} aria-label={`select ${s.merchant.nameEn}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{lang === 'ar' ? s.merchant.nameAr : s.merchant.nameEn} · {s.location?.name}</div>
                    <div className="text-xs text-muted">{s.location?.addressLine}, {s.location?.area} {s.location?.contactPhone && <span dir="ltr">· {s.location.contactPhone}</span>}</div>
                  </div>
                  <span className="rounded-md bg-paper px-2 py-0.5 text-xs font-medium">{s.orders.length} {t.parcels}</span>
                </header>
                <ul className="divide-y divide-line">
                  {s.orders.map((o) => (
                    <li key={o.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        aria-label={`select ${o.trackingNumber}`}
                        onChange={() => {
                          const n = new Set(selected);
                          if (n.has(o.id)) n.delete(o.id);
                          else n.add(o.id);
                          setSelected(n);
                        }}
                      />
                      <Link href={`/orders/${o.id}`} className="font-mono text-xs text-accent-strong hover:underline">{o.trackingNumber}</Link>
                      <StatusBadge status={o.status} />
                      <span className="ms-auto text-xs text-muted">{o.pickupDriver?.fullName ?? t.notAssigned}</span>
                      <Money value={o.codAmount} className="text-xs" />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

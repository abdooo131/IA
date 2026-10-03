'use client';

import { Button, Card, ErrorBox, Field, formatDateTime, inputClass, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { DriverSelect, HubSelect, useDrivers, useHubs } from '../shared';

interface TransferRow {
  id: string;
  code: string;
  status: 'OPEN' | 'IN_TRANSIT' | 'RECEIVED';
  createdAt: string;
  dispatchedAt: string | null;
  originHub: { code: string };
  destinationHub: { code: string };
  driver: { fullName: string } | null;
  itemCount: number;
  receivedCount: number;
}

const TRANSFER_STYLE = { OPEN: 'bg-slate-100 text-slate-700', IN_TRANSIT: 'bg-sky-50 text-sky-800', RECEIVED: 'bg-emerald-50 text-emerald-800' };

export default function TransfersPage() {
  const { api, t, lang } = useApp();
  const router = useRouter();
  const list = useAsync(() => api.get<TransferRow[]>('/ops/transfers'), []);
  const hubs = useHubs();
  const drivers = useDrivers('PICKUP');
  const [form, setForm] = useState({ originHubId: '', destinationHubId: '', driverId: '', vehicle: '' });
  const [error, setError] = useState<unknown>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const h = hubs.data ?? [];
      const tr = await api.post<{ id: string }>('/ops/transfers', {
        originHubId: form.originHubId || h[0]?.id,
        destinationHubId: form.destinationHubId || h[1]?.id,
        driverId: form.driverId || null,
        vehicle: form.vehicle || null,
      });
      router.push(`/operations/transfers/${tr.id}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t.transfers} subtitle={t.transfersSubtitle} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title={t.transfers} flush>
          {list.loading && !list.data ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="transfers-table">
                <thead className="text-[11px] uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 text-start font-medium">{t.manifest}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.route}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.status}</th>
                    <th className="px-3 py-2 text-end font-medium">{t.parcels}</th>
                    <th className="px-5 py-2 text-start font-medium">{t.created}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(list.data ?? []).length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-muted">{t.none}</td></tr>}
                  {(list.data ?? []).map((r) => (
                    <tr key={r.id} className="hover:bg-paper">
                      <td className="px-5 py-2.5"><Link href={`/operations/transfers/${r.id}`} className="font-mono text-xs text-accent-strong hover:underline">{r.code}</Link></td>
                      <td className="px-3 py-2.5 font-mono text-xs">{r.originHub.code} → {r.destinationHub.code}{r.driver && <span className="ms-2 font-sans text-muted">{r.driver.fullName}</span>}</td>
                      <td className="px-3 py-2.5"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${TRANSFER_STYLE[r.status]}`}>{t[`tr${r.status}`]}</span></td>
                      <td className="tabular px-3 py-2.5 text-end">{r.receivedCount}/{r.itemCount}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">{formatDateTime(r.createdAt, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={t.newTransfer}>
          <form onSubmit={create} className="space-y-3">
            <Field label={t.origin}>
              <HubSelect hubs={hubs.data ?? []} value={form.originHubId || hubs.data?.[0]?.id || ''} onChange={(v) => setForm({ ...form, originHubId: v })} label={t.origin} />
            </Field>
            <Field label={t.destination}>
              <HubSelect hubs={hubs.data ?? []} value={form.destinationHubId || hubs.data?.[1]?.id || ''} onChange={(v) => setForm({ ...form, destinationHubId: v })} label={t.destination} />
            </Field>
            <Field label={t.driverOptional}>
              <DriverSelect drivers={drivers.data ?? []} value={form.driverId} onChange={(v) => setForm({ ...form, driverId: v })} />
            </Field>
            <Field label={t.vehicle}>
              <input className={inputClass} value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} placeholder="Van 1234 ABC" />
            </Field>
            <ErrorBox error={error} />
            <Button type="submit" className="w-full">{t.newTransfer}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

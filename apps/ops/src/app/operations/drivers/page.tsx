'use client';

import { Button, Card, ErrorBox, Field, inputClass, Money, PageHeader, Spinner, useApp } from '@shiply/ui';
import { FormEvent, useState } from 'react';
import { HubSelect, useDrivers, useHubs, useRunSheet } from '../shared';

const VEHICLES = ['MOTORCYCLE', 'CAR', 'VAN', 'BICYCLE', 'TRUCK'] as const;

export default function DriversPage() {
  const { api, t, session } = useApp();
  const drivers = useDrivers();
  const hubs = useHubs();
  const runSheet = useRunSheet();
  const [form, setForm] = useState({ type: 'DELIVERY', fullName: '', phone: '', hubId: '', vehicle: 'MOTORCYCLE', nationalId: '' });
  const [error, setError] = useState<unknown>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const canManage = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DRIVER_MANAGER'].includes(session?.user.role ?? '');

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/ops/drivers', { ...form, hubId: form.hubId || hubs.data?.[0]?.id || null, nationalId: form.nationalId || null });
      setForm({ ...form, fullName: '', phone: '', nationalId: '' });
      drivers.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function setStatus(id: string, status: string) {
    setRowError(null);
    try {
      await api.patch(`/ops/drivers/${id}`, { status });
      drivers.reload();
    } catch (err) {
      setRowError(err);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t.drivers} subtitle={t.driversSubtitle} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title={t.drivers} flush>
          <ErrorBox error={rowError} />
          {drivers.loading && !drivers.data ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="drivers-table">
                <thead className="text-[11px] uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 text-start font-medium">{t.name}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.type}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.hub}</th>
                    <th className="px-3 py-2 text-end font-medium">{t.openWork}</th>
                    <th className="px-3 py-2 text-end font-medium">{t.cashHeldShort}</th>
                    <th className="px-3 py-2 text-end font-medium">{t.shortageOwed}</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(drivers.data ?? []).map((d) => (
                    <tr key={d.id} className={d.status !== 'ACTIVE' ? 'opacity-60' : ''}>
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{d.fullName}</div>
                        <div className="text-xs text-muted" dir="ltr">{d.phone} · {t[`v_${d.vehicle}` as 'v_MOTORCYCLE'] ?? d.vehicle}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{d.type === 'PICKUP' ? t.pickupDriverType : t.deliveryDriverType}{d.status !== 'ACTIVE' && <span className="ms-2 rounded bg-rose-50 px-1.5 text-rose-700">{t.suspended}</span>}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{d.hub?.code ?? '-'}</td>
                      <td className="tabular px-3 py-2.5 text-end">{d.type === 'PICKUP' ? d.openPickups : d.openDeliveries}</td>
                      <td className="px-3 py-2.5 text-end"><Money value={d.cashHeld} /></td>
                      <td className={`px-3 py-2.5 text-end ${d.shortageOwed > 0 ? 'text-rose-700' : 'text-muted'}`}><Money value={d.shortageOwed} /></td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-end">
                        <Button variant="ghost" className="px-2 text-xs" onClick={() => runSheet(d)}>{t.runSheet}</Button>
                        {canManage &&
                          (d.status === 'ACTIVE' ? (
                            <Button variant="ghost" className="px-2 text-xs" onClick={() => setStatus(d.id, 'SUSPENDED')}>{t.suspend}</Button>
                          ) : (
                            <Button variant="ghost" className="px-2 text-xs" onClick={() => setStatus(d.id, 'ACTIVE')}>{t.activate}</Button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {canManage && (
          <Card title={t.addDriver}>
            <form onSubmit={create} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(['DELIVERY', 'PICKUP'] as const).map((k) => (
                  <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${form.type === k ? 'bg-accent-soft ring-accent' : 'ring-line'}`}>
                    <input type="radio" name="type" checked={form.type === k} onChange={() => setForm({ ...form, type: k })} />
                    {k === 'PICKUP' ? t.pickupDriverType : t.deliveryDriverType}
                  </label>
                ))}
              </div>
              <Field label={t.fullName}><input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required minLength={3} /></Field>
              <Field label={t.phone} hint="01XXXXXXXXX"><input className={inputClass} dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></Field>
              <Field label={t.nationalId}><input className={inputClass} dir="ltr" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} /></Field>
              <Field label={t.hub}><HubSelect hubs={hubs.data ?? []} value={form.hubId || hubs.data?.[0]?.id || ''} onChange={(v) => setForm({ ...form, hubId: v })} /></Field>
              <Field label={t.vehicle}>
                <select className={inputClass} value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })}>
                  {VEHICLES.map((v) => <option key={v} value={v}>{t[`v_${v}`]}</option>)}
                </select>
              </Field>
              <ErrorBox error={error} />
              <Button type="submit" className="w-full">{t.addDriver}</Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

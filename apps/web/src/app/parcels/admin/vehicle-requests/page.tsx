'use client';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select } from '@/parcels/components/ui';
import { REQUEST_REASON, VehicleRequestsTable, type VehicleRequestRow } from '@/parcels/components/workforce';
import { api, errorMessage } from '@/parcels/lib/api';
import { todayCairo } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

export default function VehicleRequestsPage() {
  const t = useT();
  const rows = useLoad<VehicleRequestRow[]>('/admin/vehicle-requests');
  const agents = useLoad<{ id: string; name: string; supplies: string; active: boolean }[]>('/admin/agents');
  const merchants = useLoad<{ id: string; name: string }[]>('/admin/merchants');
  const hubs = useLoad<{ id: string; code: string; name: string }[]>('/reference/hubs');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ agentId: '', reason: 'MERCHANT_SPECIAL', merchantId: '', hubId: '', date: todayCairo(), price: '', notes: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api<{ code: string }>('/admin/vehicle-requests', {
        body: { ...f, merchantId: f.merchantId || null, hubId: f.hubId || null, price: Math.round(Number(f.price || 0) * 100) },
      });
      setMsg({ ok: true, text: t('Request {code} sent to the agent', { code: r.code }) });
      setOpen(false);
      await rows.reload();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('Vehicle requests')} subtitle={t('Ask an agent for a vehicle with a driver: special pickups, breakdowns, full vehicles')} actions={<Button onClick={() => setOpen((o) => !o)}>{open ? t('Close') : t('Request a vehicle')}</Button>} />
      {msg && <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      {open && (
        <Card title={t('New request')}>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('Agent')}>
              <Select required value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}>
                <option value="" disabled>{t('Choose an agent')}</option>
                {(agents.data ?? []).filter((a) => a.active && a.supplies !== 'DELIVERY').map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('Reason')}>
              <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
                {Object.entries(REQUEST_REASON).map(([k, v]) => (
                  <option key={k} value={k}>{t(v)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('Date')}>
              <Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="ltr-iso" />
            </Field>
            <Field label={t('Merchant')} hint={t('Optional')}>
              <Select value={f.merchantId} onChange={(e) => setF({ ...f, merchantId: e.target.value })}>
                <option value="">{t('None')}</option>
                {(merchants.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('Hub')} hint={t('Optional')}>
              <Select value={f.hubId} onChange={(e) => setF({ ...f, hubId: e.target.value })}>
                <option value="">{t('None')}</option>
                {(hubs.data ?? []).map((h) => (
                  <option key={h.id} value={h.id}>{h.code} · {h.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('Agreed price (EGP)')}>
              <Input required inputMode="decimal" className="ltr-iso" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            </Field>
            <Field label={t('Notes')} className="sm:col-span-2 lg:col-span-3">
              <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit">{t('Send request')}</Button>
            </div>
          </form>
        </Card>
      )}
      <Card title={t('Requests')}>
        {rows.error ? <Alert>{rows.error}</Alert> : rows.data ? <VehicleRequestsTable rows={rows.data} closeBase="/admin/vehicle-requests" onChange={() => void rows.reload()} showAgent /> : <Loading />}
      </Card>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';

interface Merchant {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  pickupAddress: string;
  governorateCode: string;
  areaId: string | null;
  homeHubId: string;
  discountBp: number;
  active: boolean;
  homeHub: { code: string };
  _count: { shipments: number };
}
interface Hub {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
interface Location {
  code: string;
  nameEn: string;
  served: boolean;
  areas: { id: string; nameEn: string }[];
}

const emptyForm = { code: '', name: '', phone: '', email: '', pickupAddress: '', governorateCode: 'CAI', areaId: '', homeHubId: '', discount: '0', active: true };

function LoginForm({ merchant, onDone }: { merchant: Merchant; onDone: () => void }) {
  const [f, setF] = useState({ name: merchant.name, email: '', password: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/admin/users', { body: { ...f, role: 'MERCHANT', merchantId: merchant.id } });
      setMsg({ ok: true, text: `Login created for ${f.email}` });
      setF({ ...f, email: '', password: '' });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-4">
      <div className="text-sm font-semibold sm:col-span-4">New login for {merchant.name}</div>
      {msg && <div className="sm:col-span-4"><Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert></div>}
      <Field label="Name">
        <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Email">
        <Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="Password" hint="8 characters or more">
        <Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" disabled={busy}>Create login</Button>
        <Button tone="secondary" onClick={onDone}>Close</Button>
      </div>
    </form>
  );
}

export default function MerchantsPage() {
  const merchants = useLoad<Merchant[]>('/admin/merchants');
  const hubs = useLoad<Hub[]>('/admin/hubs');
  const locations = useLoad<Location[]>('/reference/locations');
  const [editing, setEditing] = useState<string | null>(null);
  const [loginFor, setLoginFor] = useState<Merchant | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!merchants.data || !hubs.data || !locations.data) {
    const err = merchants.error ?? hubs.error ?? locations.error;
    return err ? <Alert>{err}</Alert> : <Loading />;
  }

  const areas = locations.data.find((l) => l.code === form.governorateCode)?.areas ?? [];

  const edit = (m: Merchant | null) => {
    setError(null);
    setLoginFor(null);
    setEditing(m ? m.id : 'new');
    setForm(
      m
        ? { code: m.code, name: m.name, phone: m.phone, email: m.email, pickupAddress: m.pickupAddress, governorateCode: m.governorateCode, areaId: m.areaId ?? '', homeHubId: m.homeHubId, discount: String(m.discountBp / 100), active: m.active }
        : { ...emptyForm, homeHubId: hubs.data!.find((h) => !h.code.startsWith('SORT'))?.id ?? '' },
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const pct = Number(form.discount);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      setError('Discount must be between 0 and 50 percent');
      return;
    }
    const { discount, areaId, ...rest } = form;
    void discount;
    const body = { ...rest, areaId: areaId || null, discountBp: Math.round(pct * 100) };
    setBusy(true);
    setError(null);
    try {
      if (editing === 'new') await api('/admin/merchants', { body });
      else await api(`/admin/merchants/${editing}`, { method: 'PUT', body });
      setEditing(null);
      await merchants.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Merchants" subtitle={`${merchants.data.length} merchants`} actions={<Button onClick={() => edit(null)}>Add merchant</Button>} />
      {editing && (
        <Card title={editing === 'new' ? 'New merchant' : 'Edit merchant'}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {error && <div className="sm:col-span-2 lg:col-span-3"><Alert>{error}</Alert></div>}
            <Field label="Code" hint="Short, 2 to 10 letters or digits">
              <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Name">
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Phone" hint="Egyptian mobile">
              <Input required inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Pickup address" className="sm:col-span-2">
              <Input required value={form.pickupAddress} onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })} />
            </Field>
            <Field label="Governorate">
              <Select value={form.governorateCode} onChange={(e) => setForm({ ...form, governorateCode: e.target.value, areaId: '' })}>
                {locations.data.map((l) => (
                  <option key={l.code} value={l.code}>{l.nameEn}</option>
                ))}
              </Select>
            </Field>
            <Field label="Area">
              <Select value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
                <option value="">Not set</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.nameEn}</option>
                ))}
              </Select>
            </Field>
            <Field label="Home hub" hint="Picks up from this merchant; returns go back here">
              <Select required value={form.homeHubId} onChange={(e) => setForm({ ...form, homeHubId: e.target.value })}>
                <option value="" disabled>Choose a hub</option>
                {hubs.data.filter((h) => h.active).map((h) => (
                  <option key={h.id} value={h.id}>{h.code} · {h.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Shipping discount (%)">
              <Input inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>{editing === 'new' ? 'Create merchant' : 'Save'}</Button>
              <Button tone="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
      {loginFor && <LoginForm merchant={loginFor} onDone={() => setLoginFor(null)} />}
      <Card>
        <Table head={['Code', 'Name', 'Phone', 'Home hub', 'Discount', 'Parcels', 'Status', '']}>
          {merchants.data.map((m) => (
            <tr key={m.id}>
              <Td className="font-mono font-semibold">{m.code}</Td>
              <Td>
                {m.name}
                <div className="text-xs text-slate-500">{m.pickupAddress}</div>
              </Td>
              <Td>{m.phone}</Td>
              <Td className="font-mono">{m.homeHub.code}</Td>
              <Td>{m.discountBp / 100}%</Td>
              <Td className="tabular-nums">{m._count.shipments}</Td>
              <Td>{m.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              <Td>
                <div className="flex gap-1">
                  <Button tone="ghost" onClick={() => edit(m)}>Edit</Button>
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setEditing(null);
                      setLoginFor(m);
                    }}
                  >
                    Add login
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

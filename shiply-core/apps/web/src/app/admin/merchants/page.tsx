'use client';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

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
  const t = useT();
  const [f, setF] = useState({ name: merchant.name, email: '', password: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/admin/users', { body: { ...f, role: 'MERCHANT', merchantId: merchant.id } });
      setMsg({ ok: true, text: t('Login created for {email}', { email: f.email }) });
      setF({ ...f, email: '', password: '' });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl bg-surface p-4 shadow-sm sm:grid-cols-4">
      <div className="text-h3 sm:col-span-4">{t('New login for {name}', { name: merchant.name })}</div>
      {msg && <div className="sm:col-span-4"><Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert></div>}
      <Field label={t('Name')}>
        <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label={t('Email')}>
        <Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label={t('Password')} hint={t('8 characters or more')}>
        <Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" disabled={busy}>{t('Create login')}</Button>
        <Button tone="secondary" onClick={onDone}>{t('Close')}</Button>
      </div>
    </form>
  );
}

export default function MerchantsPage() {
  const t = useT();
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
        : emptyForm,
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const pct = Number(form.discount);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      setError(t('Discount must be between 0 and 50 percent'));
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
      <PageHeader title={t('Merchants')} subtitle={t('{count} merchants', { count: merchants.data.length })} actions={<Button onClick={() => edit(null)}>{t('Add merchant')}</Button>} />
      {editing && (
        <Card title={editing === 'new' ? t('New merchant') : t('Edit merchant')}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {error && <div className="sm:col-span-2 lg:col-span-3"><Alert>{error}</Alert></div>}
            <Field label={t('Code')} hint={t('Short, 2 to 10 letters or digits')}>
              <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('Name')}>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('Phone')} hint={t('Egyptian mobile')}>
              <Input required inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label={t('Email')}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label={t('Pickup address')} className="sm:col-span-2">
              <Input required value={form.pickupAddress} onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })} />
            </Field>
            <Field label={t('Governorate')}>
              <Select value={form.governorateCode} onChange={(e) => setForm({ ...form, governorateCode: e.target.value, areaId: '' })}>
                {locations.data.map((l) => (
                  <option key={l.code} value={l.code}>{l.nameEn}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('Area')}>
              <Select value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
                <option value="">{t('Not set')}</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.nameEn}</option>
                ))}
              </Select>
            </Field>
            <div className="rounded-md bg-selected-bg px-3 py-2 text-body-sm">
              <span className="block text-caption font-bold text-link">{t('Pickup sorting facility')}</span>
              {editing && editing !== 'new' ? <span className="ltr-iso font-bold">{merchants.data.find((m) => m.id === editing)?.homeHub.code ?? ''} · </span> : ''}{t('Chosen by the system: the facility nearest the pickup area')}
            </div>
            <Field label={t('Shipping discount (%)')}>
              <Input inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-body-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {t('Active')}
            </label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>{editing === 'new' ? t('Create merchant') : t('Save')}</Button>
              <Button tone="secondary" onClick={() => setEditing(null)}>{t('Cancel')}</Button>
            </div>
          </form>
        </Card>
      )}
      {loginFor && <LoginForm merchant={loginFor} onDone={() => setLoginFor(null)} />}
      <Card>
        <Table head={[t('Code'), t('Name'), t('Phone'), t('Pickup facility'), t('Discount'), t('Parcels'), t('Status'), '']}>
          {merchants.data.map((m) => (
            <tr key={m.id}>
              <Td className="ltr-iso font-bold">{m.code}</Td>
              <Td>
                {m.name}
                <div className="text-caption text-text-muted">{m.pickupAddress}</div>
              </Td>
              <Td><span className="ltr-iso">{m.phone}</span></Td>
              <Td className="ltr-iso font-bold">{m.homeHub.code}</Td>
              <Td className="tabular ltr-iso">{m.discountBp / 100}%</Td>
              <Td className="tabular">{m._count.shipments}</Td>
              <Td>{m.active ? <Badge tone="green">{t('Active')}</Badge> : <Badge>{t('Inactive')}</Badge>}</Td>
              <Td>
                <div className="flex gap-1">
                  <Button tone="ghost" onClick={() => edit(m)}>{t('Edit')}</Button>
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setEditing(null);
                      setLoginFor(m);
                    }}
                  >
                    {t('Add login')}
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

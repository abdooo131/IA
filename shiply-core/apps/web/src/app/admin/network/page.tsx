'use client';
import { Fragment, useState } from 'react';
import { egpToPiastres } from '@shiply/shared';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

interface Hub {
  id: string;
  code: string;
  name: string;
  address: string;
  isSorting: boolean;
  parentId: string | null;
  lat: number;
  lng: number;
  active: boolean;
}
interface Zone {
  code: string;
  name: string;
  transitDays: number;
  priceS: number;
  priceM: number;
  priceL: number;
  priceXL: number;
}
interface Area {
  id: string;
  governorateCode: string;
  nameEn: string;
  nameAr: string;
  hubId: string | null;
}
interface Governorate {
  code: string;
  nameEn: string;
  nameAr: string;
  zoneCode: string;
  hubId: string | null;
  areas: Area[];
}

const emptyHub = { code: '', name: '', address: '', isSorting: false, active: true, lat: '', lng: '', parentId: '' };

function HubsCard({ hubs, reload }: { hubs: Hub[]; reload: () => Promise<void> }) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyHub);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const edit = (h: Hub | null) => {
    setError(null);
    setEditing(h ? h.id : 'new');
    setForm(h ? { code: h.code, name: h.name, address: h.address, isSorting: h.isSorting, active: h.active, lat: String(h.lat), lng: String(h.lng), parentId: h.parentId ?? '' } : emptyHub);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lat = Number(form.lat);
      const lng = Number(form.lng);
      if (!form.lat || !form.lng || Number.isNaN(lat) || Number.isNaN(lng)) throw new Error(t('Type the map position, for example 30.0566 and 31.3301'));
      const body = { ...form, lat, lng, parentId: form.isSorting ? null : form.parentId || null };
      if (editing === 'new') await api('/admin/hubs', { body });
      else await api(`/admin/hubs/${editing}`, { method: 'PUT', body });
      setEditing(null);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('Sorting facilities and last mile hubs')} actions={<Button tone="secondary" onClick={() => edit(null)}>{t('Add')}</Button>}>
      {editing && (
        <form onSubmit={save} className="mb-5 grid gap-3 rounded-md bg-surface-raised p-4 ring-1 ring-line sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
          <Field label={t('Code')} hint={t('2 to 10 letters, digits or dashes')}>
            <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t('Name')}>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('Address')} className="sm:col-span-2">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label={t('Latitude')} hint={t('From Google Maps, for example 30.0566')}>
            <Input inputMode="decimal" required value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
          </Field>
          <Field label={t('Longitude')} hint={t('For example 31.3301')}>
            <Input inputMode="decimal" required value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-body-sm">
            <input type="checkbox" checked={form.isSorting} onChange={(e) => setForm({ ...form, isSorting: e.target.checked })} />
            {t('Sorting facility (inbound, sorting and outbound teams; receives pickups)')}
          </label>
          {!form.isSorting && (
            <Field label={t('Fed by sorting facility')} hint={t('Leave on Nearest to let the system pick by distance')}>
              <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                <option value="">{t('Nearest')}</option>
                {hubs.filter((x) => x.isSorting).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
              </Select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-body-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            {t('Active')}
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>{editing === 'new' ? t('Create') : t('Save')}</Button>
            <Button tone="secondary" onClick={() => setEditing(null)}>{t('Cancel')}</Button>
          </div>
        </form>
      )}
      <Table head={[t('Code'), t('Name'), t('Address'), t('Type'), t('Fed by'), t('Status'), '']}>
        {hubs.map((h) => (
          <tr key={h.id}>
            <Td className="ltr-iso font-bold">{h.code}</Td>
            <Td>{h.name}</Td>
            <Td className="text-text-muted">{h.address}</Td>
            <Td>{h.isSorting ? <Badge tone="blue">{t('Sorting facility')}</Badge> : t('Last mile hub')}</Td>
            <Td className="ltr-iso">{h.parentId ? hubs.find((x) => x.id === h.parentId)?.code : ''}</Td>
            <Td>{h.active ? <Badge tone="green">{t('Active')}</Badge> : <Badge>{t('Inactive')}</Badge>}</Td>
            <Td>
              <Button tone="ghost" onClick={() => edit(h)}>{t('Edit')}</Button>
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function ZoneRow({ zone, onSaved }: { zone: Zone; onSaved: () => Promise<void> }) {
  const t = useT();
  const toEgp = (p: number) => (p / 100).toString();
  const [f, setF] = useState({
    name: zone.name,
    transitDays: String(zone.transitDays),
    priceS: toEgp(zone.priceS),
    priceM: toEgp(zone.priceM),
    priceL: toEgp(zone.priceL),
    priceXL: toEgp(zone.priceXL),
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    const prices = [f.priceS, f.priceM, f.priceL, f.priceXL].map(egpToPiastres);
    const days = Number(f.transitDays);
    if (prices.some((p) => p === null) || !Number.isInteger(days) || days < 0) {
      setMsg({ ok: false, text: t('Check the prices and days') });
      return;
    }
    try {
      await api(`/admin/zones/${zone.code}`, {
        method: 'PUT',
        body: { name: f.name, transitDays: days, priceS: prices[0], priceM: prices[1], priceL: prices[2], priceXL: prices[3] },
      });
      setMsg({ ok: true, text: t('Saved') });
      await onSaved();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  const num = (key: keyof typeof f) => (
    <Input inputMode="decimal" className="w-20" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
  );

  return (
    <tr>
      <Td className="ltr-iso font-bold">{zone.code}</Td>
      <Td>
        <Input className="w-40" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Td>
      <Td>{num('transitDays')}</Td>
      <Td>{num('priceS')}</Td>
      <Td>{num('priceM')}</Td>
      <Td>{num('priceL')}</Td>
      <Td>{num('priceXL')}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <Button tone="secondary" onClick={save}>{t('Save')}</Button>
          {msg && <span className={msg.ok ? 'text-caption font-bold text-status-delivered' : 'text-caption font-bold text-danger'}>{msg.text}</span>}
        </div>
      </Td>
    </tr>
  );
}

function GovernoratesCard({ governorates, zones, hubs, reload }: { governorates: Governorate[]; zones: Zone[]; hubs: Hub[]; reload: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [area, setArea] = useState({ nameEn: '', nameAr: '', hubId: '' });
  const deliveryHubs = hubs.filter((h) => h.active && !h.isSorting);

  const saveGov = async (g: Governorate, change: Partial<Pick<Governorate, 'zoneCode' | 'hubId'>>) => {
    setError(null);
    try {
      await api(`/admin/governorates/${g.code}`, { method: 'PUT', body: { zoneCode: change.zoneCode ?? g.zoneCode, hubId: change.hubId !== undefined ? change.hubId : g.hubId } });
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const saveArea = async (a: Area, hubId: string | null) => {
    setError(null);
    try {
      await api(`/admin/areas/${a.id}`, { method: 'PUT', body: { governorateCode: a.governorateCode, nameEn: a.nameEn, nameAr: a.nameAr, hubId } });
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const addArea = async (e: React.FormEvent, code: string) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/areas', { body: { governorateCode: code, nameEn: area.nameEn, nameAr: area.nameAr, hubId: area.hubId || null } });
      setArea({ nameEn: '', nameAr: '', hubId: '' });
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card title={t('Governorates and areas')}>
      <p className="mb-3 text-body-sm text-text-muted">
        {t('Each governorate has a pricing zone and a last mile hub. With no hub we do not deliver there. Areas can have their own hub, which wins over the governorate hub.')}
      </p>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <Table head={[t('Governorate'), t('Zone'), t('Last mile hub'), t('Areas')]}>
        {governorates.map((g) => (
          <Fragment key={g.code}>
            <tr>
              <Td>
                <span className="font-bold">{locale === 'ar' ? g.nameAr : g.nameEn}</span>
                <span className="ms-2 text-text-muted">{locale === 'ar' ? g.nameEn : g.nameAr}</span>
                <span className="ltr-iso ms-2 text-caption text-text-muted">{g.code}</span>
              </Td>
              <Td>
                <Select className="w-40" value={g.zoneCode} onChange={(e) => saveGov(g, { zoneCode: e.target.value })}>
                  {zones.map((z) => (
                    <option key={z.code} value={z.code}>{z.name}</option>
                  ))}
                </Select>
              </Td>
              <Td>
                <Select className="w-48" value={g.hubId ?? ''} onChange={(e) => saveGov(g, { hubId: e.target.value || null })}>
                  <option value="">{t('Not served')}</option>
                  {deliveryHubs.map((h) => (
                    <option key={h.id} value={h.id}>{h.code} · {h.name}</option>
                  ))}
                </Select>
              </Td>
              <Td>
                <Button tone="ghost" onClick={() => setOpen(open === g.code ? null : g.code)}>
                  {t(g.areas.length === 1 ? '{n} area' : '{n} areas', { n: g.areas.length })} {open === g.code ? '▲' : '▼'}
                </Button>
              </Td>
            </tr>
            {open === g.code && (
              <tr>
                <td colSpan={4} className="bg-surface-raised px-3 py-3">
                  <div className="space-y-2">
                    {g.areas.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-3 text-body-sm">
                        <span className="w-40 font-semibold">{a.nameEn}</span>
                        <span className="w-40 text-text-muted">{a.nameAr}</span>
                        <Select className="w-56" value={a.hubId ?? ''} onChange={(e) => saveArea(a, e.target.value || null)}>
                          <option value="">{t('Use governorate hub')}</option>
                          {deliveryHubs.map((h) => (
                            <option key={h.id} value={h.id}>{h.code} · {h.name}</option>
                          ))}
                        </Select>
                      </div>
                    ))}
                    <form onSubmit={(e) => addArea(e, g.code)} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                      <Field label={t('Area (English)')}>
                        <Input required value={area.nameEn} onChange={(e) => setArea({ ...area, nameEn: e.target.value })} />
                      </Field>
                      <Field label={t('Area (Arabic)')}>
                        <Input required dir="rtl" value={area.nameAr} onChange={(e) => setArea({ ...area, nameAr: e.target.value })} />
                      </Field>
                      <Field label={t('Hub')}>
                        <Select value={area.hubId} onChange={(e) => setArea({ ...area, hubId: e.target.value })}>
                          <option value="">{t('Use governorate hub')}</option>
                          {deliveryHubs.map((h) => (
                            <option key={h.id} value={h.id}>{h.code}</option>
                          ))}
                        </Select>
                      </Field>
                      <Button type="submit" tone="secondary">{t('Add area')}</Button>
                    </form>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>
    </Card>
  );
}

export default function NetworkPage() {
  const t = useT();
  const hubs = useLoad<Hub[]>('/admin/hubs');
  const zones = useLoad<Zone[]>('/admin/zones');
  const govs = useLoad<Governorate[]>('/admin/governorates');

  if (!hubs.data || !zones.data || !govs.data) {
    const err = hubs.error ?? zones.error ?? govs.error;
    return err ? <Alert>{err}</Alert> : <Loading />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('Network')} subtitle={t('Sorting facilities, last mile hubs, pricing zones and which hub delivers where')} />
      <HubsCard hubs={hubs.data} reload={hubs.reload} />
      <Card title={t('Zones and prices (EGP)')}>
        <p className="mb-3 text-body-sm text-text-muted">{t('Transit days are business days from the day the parcel enters our network, before the daily cutoff.')}</p>
        <Table head={[t('Code'), t('Name'), t('Days'), t('Small'), t('Medium'), t('Large'), 'XL', '']}>
          {zones.data.map((z) => (
            <ZoneRow key={`${z.code}-${z.priceS}-${z.priceM}-${z.priceL}-${z.priceXL}-${z.transitDays}`} zone={z} onSaved={zones.reload} />
          ))}
        </Table>
      </Card>
      <GovernoratesCard governorates={govs.data} zones={zones.data} hubs={hubs.data} reload={govs.reload} />
    </div>
  );
}

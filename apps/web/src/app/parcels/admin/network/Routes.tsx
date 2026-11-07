'use client';
import { useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { RouteChain } from '@/parcels/components/RouteChain';
import { Alert, Badge, Button, Card, Empty, Field, Input, Select, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';

interface Facility { id: string; code: string; name: string; isSorting: boolean }
interface Link { id: string; fromId: string; toId: string; hours: number; active: boolean; from: { code: string; name: string } | null; to: { code: string; name: string } | null }
interface Cover { code: string; nameEn: string; nameAr: string; served: boolean; hub: string | null; areas: number; areasServed: number }
interface Preview { ok: boolean; from: string; reason?: string; steps?: { code: string; name: string; kind: string }[]; transfers?: number; zone?: string; transitDays?: number }

/** Where we deliver today, at a glance. Change it per governorate or area below. */
export function CoverageCard() {
  const t = useT();
  const locale = useLocale();
  const cov = useLoad<Cover[]>('/admin/coverage');
  if (!cov.data) return null;
  const served = cov.data.filter((g) => g.served);
  return (
    <Card title={t('Where we deliver')}>
      <p className="mb-3 text-body-sm text-text-muted">{t('We pick up and deliver only in governorates and areas that have a last mile hub. Give a governorate a hub below to open it.')}</p>
      <div className="flex flex-wrap gap-2">
        {served.length === 0 ? <Badge tone="red">{t('Nowhere yet')}</Badge> : served.map((g) => <Badge key={g.code} tone="green">{locale === 'ar' ? g.nameAr : g.nameEn} · <span className="ltr-iso">{g.hub}</span></Badge>)}
      </div>
      <p className="mt-2 text-caption text-text-muted">{t('{n} of {m} governorates served', { n: served.length, m: cov.data.length })}</p>
    </Card>
  );
}

/** The trucks between sorting facilities. A parcel may pass through up to two facilities in between. */
export function TruckRoutesCard({ hubs }: { hubs: Facility[] }) {
  const t = useT();
  const links = useLoad<Link[]>('/admin/line-hauls');
  const facilities = hubs.filter((h) => h.isSorting);
  const [f, setF] = useState({ fromId: '', toId: '', hours: '12', bothWays: true });
  const r = useRunner(() => links.reload());
  return (
    <Card title={t('Truck routes between facilities')}>
      <p className="mb-3 text-body-sm text-text-muted">{t('A parcel goes from the facility nearest the merchant to the facility that feeds the customer hub. With no truck routes listed, every facility sends straight to every other one. Once you list routes, parcels follow them and may pass through up to two facilities in between.')}</p>
      {r.view}
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_7rem_auto_auto]">
        <Select value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value })}><option value="">{t('From')}</option>{facilities.map((h) => <option key={h.id} value={h.id}>{h.code} · {h.name}</option>)}</Select>
        <Select value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })}><option value="">{t('To')}</option>{facilities.map((h) => <option key={h.id} value={h.id}>{h.code} · {h.name}</option>)}</Select>
        <Input inputMode="numeric" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value.replace(/\D/g, '') })} placeholder={t('Hours')} />
        <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={f.bothWays} onChange={(e) => setF({ ...f, bothWays: e.target.checked })} />{t('Both ways')}</label>
        <Button disabled={r.busy || !f.fromId || !f.toId} onClick={() => void r.run(() => api('/admin/line-hauls', { body: { fromId: f.fromId, toId: f.toId, bothWays: f.bothWays, hours: Number(f.hours) || 12 } }), 'Saved')}>{t('Add')}</Button>
      </div>
      {!links.data ? null : links.data.length === 0 ? <Empty>{t('No truck routes listed: every facility sends straight to every other one')}</Empty> : (
        <Table head={[t('From'), t('To'), t('Hours on the road'), '']}>
          {links.data.map((l) => (
            <tr key={l.id}>
              <Td><span className="ltr-iso font-bold">{l.from?.code}</span> <span className="text-caption text-text-muted">{l.from?.name}</span></Td>
              <Td><span className="ltr-iso font-bold">{l.to?.code}</span> <span className="text-caption text-text-muted">{l.to?.name}</span></Td>
              <Td className="tabular">{l.hours}</Td>
              <Td><button type="button" className="text-caption font-bold text-danger" onClick={() => void r.run(() => api(`/admin/line-hauls/${l.id}`, { method: 'DELETE' }), 'Removed')}>{t('Remove')}</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

/** Ask the system how a parcel would travel, before any merchant sends one. */
export function TryRouteCard({ governorates }: { governorates: { code: string; nameEn: string; nameAr: string; areas: { id: string; nameEn: string; nameAr: string }[] }[] }) {
  const t = useT();
  const locale = useLocale();
  const merchants = useLoad<{ id: string; name: string }[]>('/admin/merchants');
  const [q, setQ] = useState({ merchantId: '', fromGovernorate: 'CAI', governorateCode: 'GIZ', areaId: '' });
  const [res, setRes] = useState<Preview | null>(null);
  const gov = governorates.find((g) => g.code === q.governorateCode);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const run = async () => {
    const p = new URLSearchParams({ governorateCode: q.governorateCode, ...(q.areaId ? { areaId: q.areaId } : {}), ...(q.merchantId ? { merchantId: q.merchantId } : { fromGovernorate: q.fromGovernorate }) });
    setRes(await api<Preview>(`/admin/route-preview?${p}`));
  };
  return (
    <Card title={t('Try a route')}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t('From a merchant')}>
          <Select value={q.merchantId} onChange={(e) => setQ({ ...q, merchantId: e.target.value })}>
            <option value="">{t('Any merchant in a governorate')}</option>
            {merchants.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        {!q.merchantId && (
          <Field label={t('Pickup governorate')}>
            <Select value={q.fromGovernorate} onChange={(e) => setQ({ ...q, fromGovernorate: e.target.value })}>{governorates.map((g) => <option key={g.code} value={g.code}>{name(g)}</option>)}</Select>
          </Field>
        )}
        <Field label={t('To governorate')}>
          <Select value={q.governorateCode} onChange={(e) => setQ({ ...q, governorateCode: e.target.value, areaId: '' })}>{governorates.map((g) => <option key={g.code} value={g.code}>{name(g)}</option>)}</Select>
        </Field>
        <Field label={t('Area')}>
          <Select value={q.areaId} onChange={(e) => setQ({ ...q, areaId: e.target.value })}><option value="">{t('Any')}</option>{gov?.areas.map((a) => <option key={a.id} value={a.id}>{name(a)}</option>)}</Select>
        </Field>
      </div>
      <Button className="mt-3" onClick={() => void run()}>{t('Show the way')}</Button>
      {res && (
        <div className="mt-4 space-y-2">
          {!res.ok ? <Alert>{t(res.reason ?? 'No route')}</Alert> : (
            <>
              <RouteChain route={res.steps!.map((s) => s.code)} names={Object.fromEntries(res.steps!.map((s) => [s.code, s.name]))} />
              <p className="text-body-sm text-text-muted">
                {res.transfers ? t('{n} facilities in between', { n: res.transfers }) : t('No facility in between')} · {res.zone} · {t('{n} days', { n: res.transitDays ?? 0 })}
              </p>
              <ul className="text-caption text-text-muted">{res.steps!.map((s) => <li key={s.code}><span className="ltr-iso font-bold text-text">{s.code}</span> {s.name}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

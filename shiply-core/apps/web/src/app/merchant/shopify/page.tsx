'use client';
import { PARCEL_SIZES } from '@shiply/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { MoneyInput, toPiastres, useRunner } from '@/components/money';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Draft { customerName: string; customerPhone: string; address: string; governorateCode: string; size: string; codAmount: number; description: string; merchantRef: string }
interface Order { id: string; orderName: string; status: string; error: string; createdAt: string; draft: Draft; parcel: { id: string; trackingNumber: string; status: string } | null }
interface Store { id: string; shop: string; autoCreate: boolean; defaultSize: string; pushUpdates: boolean; active: boolean; installedAt: string; uninstalledAt: string | null }
interface View { configured: boolean; store: Store | null; orders: Order[] }

const STATUS: Record<string, [string, 'green' | 'amber' | 'red' | 'slate' | 'blue']> = {
  CREATED: ['Parcel made', 'green'],
  WAITING: ['Waiting for you', 'amber'],
  FAILED: ['Needs a fix', 'red'],
  SKIPPED: ['Skipped', 'slate'],
  CANCELLED: ['Cancelled in Shopify', 'slate'],
  CREATING: ['Making the parcel', 'blue'],
};

const ERRORS: Record<string, string> = {
  signature: 'Shopify could not be verified. Try connecting again',
  expired: 'The connection took too long. Try again',
  mismatch: 'The store did not match. Try again from this page',
  exchange: 'Shopify did not accept the connection. Try again',
};

function Fix({ o, govs, onDone }: { o: Order; govs: { code: string; nameEn: string }[]; onDone: () => void }) {
  const t = useT();
  const r = useRunner(onDone);
  const [f, setF] = useState({ customerName: o.draft.customerName, customerPhone: o.draft.customerPhone, address: o.draft.address, governorateCode: o.draft.governorateCode, size: o.draft.size, cod: String(o.draft.codAmount / 100) });
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-surface-raised p-4">
      {r.view}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('Customer name')}><Input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field>
        <Field label={t('Customer mobile')}><Input value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} className="ltr-iso" /></Field>
        <Field label={t('Governorate')}>
          <Select value={f.governorateCode} onChange={(e) => setF({ ...f, governorateCode: e.target.value })}>
            <option value="">{t('Choose…')}</option>
            {govs.map((g) => <option key={g.code} value={g.code}>{t(g.nameEn)}</option>)}
          </Select>
        </Field>
        <Field label={t('Address')}><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={t('Size')}><Select value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>{PARCEL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        <Field label={t('Cash to collect (EGP)')}><MoneyInput value={f.cod} onChange={(v) => setF({ ...f, cod: v })} /></Field>
      </div>
      <Button disabled={r.busy} onClick={() => void r.run(() => api(`/merchant/shopify/orders/${o.id}/create`, {
        body: { customerName: f.customerName, customerPhone: f.customerPhone, address: f.address, governorateCode: f.governorateCode || undefined, size: f.size, codAmount: Number(f.cod) ? toPiastres(f.cod) : 0 },
      }), 'Parcel made')}>{t('Make the parcel')}</Button>
    </div>
  );
}

function ShopifyInner() {
  const t = useT();
  const params = useSearchParams();
  const view = useLoad<View>('/merchant/shopify');
  const govs = useLoad<{ code: string; nameEn: string }[]>('/reference/locations');
  const [shop, setShop] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ autoCreate: boolean; defaultSize: string; pushUpdates: boolean } | null>(null);
  const r = useRunner(() => view.reload());
  useEffect(() => {
    if (view.data?.store) setSettings({ autoCreate: view.data.store.autoCreate, defaultSize: view.data.store.defaultSize, pushUpdates: view.data.store.pushUpdates });
  }, [view.data?.store]);

  if (!view.data) return view.error ? <Alert>{t(view.error)}</Alert> : <Loading />;
  const v = view.data;
  const store = v.store?.active ? v.store : null;
  const error = params.get('error');

  return (
    <div className="space-y-5">
      <PageHeader title="Shopify" subtitle={t('Orders from your Shopify store become Shiply parcels, and your customers get the tracking link from Shopify')} />
      {params.get('connected') && <Alert tone="success">{t('Your Shopify store is connected')}</Alert>}
      {params.get('warning') === 'webhooks' && <Alert tone="warning">{t('Connected, but Shopify did not accept our order notifications. Disconnect and connect again')}</Alert>}
      {error && <Alert>{t(ERRORS[error] ?? 'The connection did not finish. Try again')}</Alert>}
      {r.view}

      {!v.configured ? (
        <Card><Empty>{t('The Shopify connection is not switched on for this Shiply server yet. Ask Shiply support')}</Empty></Card>
      ) : !store ? (
        <Card title={t('Connect your store')}>
          <p className="mb-3 text-body-sm text-text-muted">{t('Enter your store address. Shopify will ask you to approve the Shiply app, then bring you back here.')}</p>
          <div className="flex flex-wrap gap-2">
            <Input value={shop} onChange={(e) => setShop(e.target.value)} placeholder="mystore.myshopify.com" className="ltr-iso max-w-sm" />
            <Button disabled={r.busy || shop.trim().length < 3} onClick={() => void r.run(async () => {
              const { url } = await api<{ url: string }>('/merchant/shopify/install', { body: { shop } });
              window.location.href = url;
            }, 'Opening Shopify')}>{t('Connect Shopify')}</Button>
          </div>
        </Card>
      ) : (
        <Card title={store.shop} actions={<Badge tone="green">{t('Connected')}</Badge>}>
          <p className="text-caption text-text-muted">{t('Connected on {time}', { time: dateTime(store.installedAt) })}</p>
          {settings && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="flex items-start gap-2 text-body-sm"><input type="checkbox" className="mt-1" checked={settings.autoCreate} onChange={(e) => setSettings({ ...settings, autoCreate: e.target.checked })} />{t('Make a parcel for each new order by itself')}</label>
              <label className="flex items-start gap-2 text-body-sm"><input type="checkbox" className="mt-1" checked={settings.pushUpdates} onChange={(e) => setSettings({ ...settings, pushUpdates: e.target.checked })} />{t('Mark the order fulfilled in Shopify when we pick it up, and paid when cash is collected')}</label>
              <Field label={t('Usual parcel size')}><Select value={settings.defaultSize} onChange={(e) => setSettings({ ...settings, defaultSize: e.target.value })}>{PARCEL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={r.busy || !settings} onClick={() => void r.run(() => api('/merchant/shopify/settings', { method: 'PUT', body: settings }), 'Saved')}>{t('Save')}</Button>
            <Button tone="secondary" disabled={r.busy} onClick={() => { if (confirm(t('Disconnect your Shopify store? New orders will stop coming in'))) void r.call('/merchant/shopify/disconnect', {}, 'Disconnected. Remove the Shiply app from your Shopify admin too'); }}>{t('Disconnect')}</Button>
          </div>
        </Card>
      )}

      {v.store && (
        <Card title={t('Orders from Shopify')}>
          {v.orders.length === 0 ? <Empty>{t('No orders yet. New orders appear here as soon as they are placed')}</Empty> : (
            <ul className="divide-y divide-border">
              {v.orders.map((o) => (
                <li key={o.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{o.orderName}</span>
                        <Badge tone={STATUS[o.status]?.[1] ?? 'slate'}>{t(STATUS[o.status]?.[0] ?? o.status)}</Badge>
                        {o.parcel && <Link href={`/merchant/${o.parcel.id}`} className="ltr-iso text-caption font-bold text-link">{o.parcel.trackingNumber}</Link>}
                      </div>
                      <p className="text-caption text-text-muted">{dateTime(o.createdAt)} · {o.draft.customerName} · {o.draft.address}{o.draft.codAmount ? ` · ${t('Collect')} ${egp(o.draft.codAmount)}` : ''}</p>
                      {o.error && o.status !== 'CREATED' && <p className="mt-1 text-caption font-semibold text-danger">{o.error}</p>}
                    </div>
                    {['WAITING', 'FAILED'].includes(o.status) && (
                      <div className="flex gap-2">
                        {o.status === 'WAITING' && <Button disabled={r.busy} onClick={() => void r.call(`/merchant/shopify/orders/${o.id}/create`, {}, 'Parcel made')}>{t('Make the parcel')}</Button>}
                        <Button tone="secondary" onClick={() => setOpen(open === o.id ? null : o.id)}>{o.status === 'FAILED' ? t('Fix') : t('Edit')}</Button>
                        <Button tone="secondary" disabled={r.busy} onClick={() => void r.call(`/merchant/shopify/orders/${o.id}/skip`, {}, 'Skipped')}>{t('Skip')}</Button>
                      </div>
                    )}
                  </div>
                  {open === o.id && <Fix o={o} govs={govs.data ?? []} onDone={() => { setOpen(null); void view.reload(); }} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

export default function ShopifyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ShopifyInner />
    </Suspense>
  );
}

'use client';
import { PARCEL_SIZES } from '@shiplynow/shared/parcels';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Icon } from '@/parcels/components/Icon';
import { Label, type LabelData } from '@/parcels/components/Label';
import { Logo } from '@/parcels/components/Logo';
import { RouteChain } from '@/parcels/components/RouteChain';
import { Alert, Badge, Button, Card, Empty, Input, Loading, Select } from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { egp } from '@/parcels/lib/format';
import { useT } from '@/parcels/lib/i18n';

interface Draft { customerName: string; customerPhone: string; address: string; governorateCode: string; size: string; codAmount: number; description: string }
interface Row { id: string; orderId: string; orderName: string; status: string; error: string; draft: Draft; parcel: { trackingNumber: string; route: string[] } | null }
interface View { shop: string; merchant: string; served: { code: string; nameEn: string; nameAr: string }[]; orders: Row[] }
interface Result { created: number; failed: number; results: { id: string; ok: boolean; error: string }[]; labels: LabelData[] }

const ERRORS: Record<string, string> = {
  signature: 'This link could not be checked. Open it again from Shopify',
  expired: 'This link has expired. Pick the orders in Shopify again',
  not_connected: 'This store is not connected to Shiply. Connect it from your Shiply panel first',
  no_orders: 'No orders were picked. Tick orders in Shopify, then choose Ship with Shiply',
  shopify: 'Shopify did not send the orders. Try again in a minute',
};

/**
 * Opened from Shopify: the merchant ticked orders in their admin and chose "Ship with Shiply".
 * They check each one, fix anything missing, and make the AWBs, then print the labels here.
 */
function Ship() {
  const t = useT();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(params.get('error') ? t(ERRORS[params.get('error')!] ?? 'Something went wrong') : null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [fixes, setFixes] = useState<Record<string, Partial<Draft>>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = async () => {
    try {
      const v = await api<View>(`/integrations/shopify/ship/orders?token=${encodeURIComponent(token)}`);
      setView(v);
      setPicked(Object.fromEntries(v.orders.filter((o) => o.status === 'WAITING').map((o) => [o.id, true])));
    } catch (e) {
      setError(t(errorMessage(e)));
    }
  };
  useEffect(() => {
    if (token) void load();
  }, [token]);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const orders = Object.entries(picked).filter(([, on]) => on).map(([id]) => {
        const f = fixes[id] ?? {};
        return { id, fix: { ...f, ...(f.codAmount !== undefined ? { codAmount: f.codAmount } : {}) } };
      });
      const r = await api<Result>('/integrations/shopify/ship/create', { body: { token, orders } });
      setResult(r);
      await load();
    } catch (e) {
      setError(t(errorMessage(e)));
    } finally {
      setBusy(false);
    }
  };

  if (result && result.labels.length) {
    return (
      <div className="min-h-screen bg-bg print:bg-white">
        <style>{`@page { size: 100mm 150mm; margin: 0; } @media print { .label { page-break-after: always; break-after: page; } }`}</style>
        <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
          <div className="flex items-center gap-3"><Logo /><span className="text-body-sm font-bold">{t('{n} AWBs made', { n: result.created })}{result.failed ? ` · ${t('{n} not made', { n: result.failed })}` : ''}</span></div>
          <div className="flex gap-2">
            <Button tone="secondary" onClick={() => setResult(null)}>{t('Back to the orders')}</Button>
            <Button onClick={() => window.print()}><Icon name="print" size={18} />{t('Print labels')}</Button>
          </div>
        </div>
        <div className="space-y-4 py-4 print:space-y-0 print:py-0">{result.labels.map((l) => <Label key={l.trackingNumber} data={l} />)}</div>
      </div>
    );
  }

  const count = Object.values(picked).filter(Boolean).length;
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Logo />
          {view && <span className="text-body-sm text-text-muted">{view.merchant} · <span className="ltr-iso">{view.shop}</span></span>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <h1 className="text-h2">{t('Ship with Shiply')}</h1>
        <p className="text-body-sm text-text-muted">{t('Check the orders you picked in Shopify. Fix anything marked red, then make the AWBs and print the labels. A courier picks them up from your warehouse.')}</p>
        {error && <Alert>{error}</Alert>}
        {result && result.failed > 0 && <Alert tone="warning">{t('{n} orders were not made:', { n: result.failed })} {result.results.filter((r) => !r.ok).map((r) => r.error).join('; ')}</Alert>}
        {!token && !error ? <Alert>{t('Open this page from Shopify: tick orders, then choose Ship with Shiply')}</Alert> : !view ? (error ? null : <Loading />) : view.orders.length === 0 ? <Card><Empty>{t('None of the picked orders could be read')}</Empty></Card> : (
          <>
            {view.orders.map((o) => {
              const open = o.status === 'WAITING' || o.status === 'FAILED';
              const f = { ...o.draft, ...(fixes[o.id] ?? {}) };
              const set = (patch: Partial<Draft>) => setFixes({ ...fixes, [o.id]: { ...(fixes[o.id] ?? {}), ...patch } });
              return (
                <Card key={o.id}>
                  <div className="flex flex-wrap items-start gap-3">
                    {open && <input type="checkbox" className="mt-1 h-5 w-5" checked={!!picked[o.id]} onChange={(e) => setPicked({ ...picked, [o.id]: e.target.checked })} aria-label={o.orderName} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{o.orderName}</span>
                        {o.parcel ? <Badge tone="green">{t('AWB')} <span className="ltr-iso">{o.parcel.trackingNumber}</span></Badge> : o.status === 'FAILED' ? <Badge tone="red">{t('Needs a fix')}</Badge> : o.status === 'SKIPPED' ? <Badge>{t('Skipped')}</Badge> : <Badge tone="amber">{t('Ready')}</Badge>}
                        {f.codAmount > 0 ? <Badge tone="blue">{t('Collect')} {egp(f.codAmount)}</Badge> : <Badge>{t('Paid')}</Badge>}
                      </div>
                      <p className="text-body-sm">{f.customerName} · <span className="ltr-iso">{f.customerPhone}</span></p>
                      <p className="text-caption text-text-muted">{f.address}{f.description ? ` · ${f.description}` : ''}</p>
                      {o.parcel && <div className="mt-2"><RouteChain route={o.parcel.route} /></div>}
                      {o.error && !o.parcel && <p className="mt-1 text-caption font-semibold text-danger">{o.error}</p>}
                      {open && o.status === 'FAILED' && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-4">
                          <Input value={f.customerPhone} onChange={(e) => set({ customerPhone: e.target.value })} placeholder={t('Customer mobile')} className="ltr-iso" />
                          <Select value={f.governorateCode} onChange={(e) => set({ governorateCode: e.target.value })}>
                            <option value="">{t('Governorate')}</option>
                            {view.served.map((g) => <option key={g.code} value={g.code}>{t(g.nameEn)}</option>)}
                          </Select>
                          <Input value={f.address} onChange={(e) => set({ address: e.target.value })} placeholder={t('Address')} />
                          <Select value={f.size} onChange={(e) => set({ size: e.target.value })}>{PARCEL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
                        </div>
                      )}
                      {open && o.status === 'WAITING' && (
                        <div className="mt-2 flex items-center gap-2 text-caption">
                          <span className="text-text-muted">{t('Size')}</span>
                          <Select className="w-24" value={f.size} onChange={(e) => set({ size: e.target.value })}>{PARCEL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
            <p className="text-caption text-text-muted">{t('We deliver to')}: {view.served.map((g) => t(g.nameEn)).join(', ')}</p>
            <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-md">
              <span className="text-body-sm font-semibold">{t('{n} orders picked', { n: count })}</span>
              <Button disabled={busy || count === 0} onClick={() => void make()}>{busy ? '…' : t('Make AWBs')}</Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function ShipPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Ship />
    </Suspense>
  );
}

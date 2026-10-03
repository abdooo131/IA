'use client';

import { OrderStatus } from '@shiply/shared';
import { useState } from 'react';
import { useApp } from './app-context';
import { Button, Card, ErrorBox, formatDateTime, inputClass, Money, Spinner, StatusBadge, useAsync } from './components';
import { EVENT_LABELS, SIZE_LABELS, STATUS_LABELS, TYPE_LABELS } from './i18n';

interface OrderEvent {
  id: string;
  eventType: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  note: string | null;
  actorRole: string | null;
  createdAt: string;
}

interface OrderDetailData {
  id: string;
  trackingNumber: string;
  merchantReference: string | null;
  status: OrderStatus;
  type: 'DELIVER' | 'EXCHANGE' | 'RETURN';
  size: keyof (typeof SIZE_LABELS)['en'];
  source: string;
  customerName: string;
  customerPhone: string;
  customerPhoneAlt: string | null;
  area: string;
  addressLine: string;
  governorate: { nameEn: string; nameAr: string };
  destinationHub: { code: string; nameEn: string; nameAr: string } | null;
  needsManualHub: boolean;
  pickupLocation: { name: string; area: string } | null;
  merchant: { nameEn: string; nameAr: string };
  codAmount: number;
  allowOpenPackage: boolean;
  itemsDescription: string | null;
  returnItemsDescription: string | null;
  notes: string | null;
  shippingFee: number;
  codFee: number;
  openPackageFee: number;
  vatAmount: number;
  totalFees: number;
  failedDeliveryFee: number;
  printCount: number;
  createdAt: string;
  events: OrderEvent[];
  customerScore: { delivered: number; finished: number; percent: number | null };
  allowedTransitions: OrderStatus[];
}

export function OrderDetail({ id, showMerchant }: { id: string; showMerchant?: boolean }) {
  const { api, t, lang } = useApp();
  const { data: o, error, loading, reload } = useAsync(() => api.get<OrderDetailData>(`/orders/${id}`), [id]);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !o) return <Spinner />;
  if (error || !o) return <ErrorBox error={error} />;

  async function move() {
    if (!to) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/orders/${id}/transition`, { to, note: note || undefined });
      setTo('');
      setNote('');
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    try {
      await api.openBlob(`/orders/${id}/label`);
      reload();
    } catch (e) {
      setActionError(e);
    }
  }

  const score = o.customerScore;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-slate-900" data-testid="tracking-number">{o.trackingNumber}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <StatusBadge status={o.status} />
            <span>{TYPE_LABELS[lang][o.type]}</span>
            <span>·</span>
            <span>{SIZE_LABELS[lang][o.size]}</span>
            {showMerchant && (
              <>
                <span>·</span>
                <span>{lang === 'ar' ? o.merchant.nameAr : o.merchant.nameEn}</span>
              </>
            )}
          </div>
        </div>
        <Button onClick={print}>
          {t.printLabel} {o.printCount > 0 && `(${o.printCount})`}
        </Button>
      </div>
      <ErrorBox error={actionError} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t.customer}>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Item label={t.customerName} value={o.customerName} />
              <Item label={t.phone} value={<span dir="ltr">{o.customerPhone}{o.customerPhoneAlt ? ` / ${o.customerPhoneAlt}` : ''}</span>} />
              <Item label={t.governorate} value={lang === 'ar' ? o.governorate.nameAr : o.governorate.nameEn} />
              <Item label={t.area} value={o.area} />
              <Item label={t.address} value={o.addressLine} wide />
              <Item label={t.hub} value={o.destinationHub ? `${o.destinationHub.code} · ${lang === 'ar' ? o.destinationHub.nameAr : o.destinationHub.nameEn}` : o.needsManualHub ? t.manualHub : '-'} />
              <Item label={t.pickupLocation} value={o.pickupLocation ? `${o.pickupLocation.name} (${o.pickupLocation.area})` : '-'} />
              <Item label={t.items} value={o.itemsDescription ?? '-'} />
              {o.returnItemsDescription && <Item label={t.returnItems} value={o.returnItemsDescription} />}
              <Item label={t.reference} value={o.merchantReference ?? '-'} />
              <Item label={t.notes} value={o.notes ?? '-'} />
              <Item label={t.allowOpen} value={o.allowOpenPackage ? t.yes : t.no} />
              <Item label={t.source} value={o.source} />
            </dl>
          </Card>

          <Card title={t.timeline}>
            <ol className="relative space-y-4 border-s border-slate-200 ps-5" data-testid="timeline">
              {o.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -start-[1.65rem] top-1.5 h-2.5 w-2.5 rounded-full bg-teal-600 ring-4 ring-white" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-900">{EVENT_LABELS[lang][e.eventType] ?? e.eventType}</span>
                    {e.toStatus && e.eventType === 'STATUS_CHANGED' && (
                      <span className="text-slate-600">
                        {e.fromStatus ? STATUS_LABELS[lang][e.fromStatus] : ''} → {STATUS_LABELS[lang][e.toStatus]}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatDateTime(e.createdAt, lang)} {e.actorRole && `· ${e.actorRole}`}
                  </div>
                  {e.note && <div className="mt-1 text-sm text-slate-700">{e.note}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={t.fees}>
            <dl className="space-y-2 text-sm" data-testid="fees">
              <Row label={t.cod} value={<Money value={o.codAmount} className="font-semibold" />} />
              <hr className="border-slate-100" />
              <Row label={t.shippingFee} value={<Money value={o.shippingFee} />} />
              {o.codFee > 0 && <Row label={t.codFee} value={<Money value={o.codFee} />} />}
              {o.openPackageFee > 0 && <Row label={t.openFee} value={<Money value={o.openPackageFee} />} />}
              <Row label={t.vat} value={<Money value={o.vatAmount} />} />
              <Row label={t.total} value={<Money value={o.totalFees} className="font-semibold" />} />
              <Row label={t.failedFee} value={<Money value={o.failedDeliveryFee} />} />
            </dl>
            <p className="mt-3 text-xs text-slate-500">{t.priceFrozen}</p>
          </Card>

          <Card title={t.customerScore}>
            {score.percent === null ? (
              <p className="text-sm text-slate-500">{t.noHistory}</p>
            ) : (
              <div>
                <div className={`text-3xl font-semibold ${score.percent >= 70 ? 'text-emerald-700' : score.percent >= 40 ? 'text-amber-700' : 'text-rose-700'}`}>{score.percent}%</div>
                <p className="text-sm text-slate-600">
                  {score.delivered} {t.delivered_of} {score.finished} {t.finished}
                </p>
              </div>
            )}
          </Card>

          {o.allowedTransitions.length > 0 && (
            <Card title={t.moveTo}>
              <div className="space-y-3">
                <select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} aria-label={t.moveTo}>
                  <option value="">—</option>
                  {o.allowedTransitions.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[lang][s]}</option>
                  ))}
                </select>
                <input className={inputClass} placeholder={t.note} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button onClick={move} disabled={!to || busy} className="w-full">{t.apply}</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

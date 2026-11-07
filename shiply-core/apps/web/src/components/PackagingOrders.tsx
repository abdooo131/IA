'use client';
import { useState } from 'react';
import { useRunner } from '@/components/money';
import { Badge, Button, Card, Empty, Input, Loading, Select } from '@/components/ui';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

export interface PackOrder {
  id: string; code: string; status: string; payment: string; goodsTotal: number; deliveryFee: number; total: number; notes: string; hubId: string;
  createdAt: string; packedAt: string | null; outAt: string | null; deliveredAt: string | null; cancelReason: string; courier: string;
  merchant: { name: string; phone: string; pickupAddress: string } | null;
  lines: { id: string; qty: number; unitPrice: number; product: { sku?: string; name: string; nameAr?: string; unit: string } }[];
}

export const PACK_STATUS: Record<string, [string, 'amber' | 'blue' | 'green' | 'red' | 'slate']> = {
  PLACED: ['Waiting to be packed', 'amber'],
  PACKED: ['Packed, waiting for a courier', 'blue'],
  OUT: ['With the courier', 'blue'],
  DELIVERED: ['Delivered', 'green'],
  CANCELLED: ['Cancelled', 'slate'],
};

function Actions({ o, couriers, onDone }: { o: PackOrder; couriers: { id: string; name: string }[]; onDone: () => void }) {
  const t = useT();
  const r = useRunner(onDone);
  const [courier, setCourier] = useState('');
  const [cancel, setCancel] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {r.view}
      <div className="flex flex-wrap items-center gap-2">
        {o.status === 'PLACED' && <Button tone="primary" disabled={r.busy} onClick={() => void r.call(`/shop/orders/${o.id}/pack`, {}, 'Packed. Give it to a courier')}>{t('Packed')}</Button>}
        {o.status === 'PACKED' && (
          <>
            <Select value={courier} onChange={(e) => setCourier(e.target.value)}>
              <option value="">{t('Choose a courier')}</option>
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Button tone="primary" disabled={r.busy || !courier} onClick={() => void r.call(`/shop/orders/${o.id}/out`, { courierId: courier }, 'With the courier. The merchant got the code by SMS')}>{t('Give to courier')}</Button>
          </>
        )}
        {['PLACED', 'PACKED', 'OUT'].includes(o.status) && cancel === null && <Button tone="secondary" onClick={() => setCancel('')}>{t('Cancel order')}</Button>}
      </div>
      {cancel !== null && (
        <div className="flex flex-wrap gap-2">
          <Input value={cancel} onChange={(e) => setCancel(e.target.value)} placeholder={t('Why?')} />
          <Button tone="secondary" onClick={() => setCancel(null)}>{t('Back')}</Button>
          <Button tone="danger" disabled={r.busy || cancel.trim().length < 3} onClick={() => void r.call(`/shop/orders/${o.id}/cancel`, { reason: cancel }, 'Cancelled. The stock is back on the shelf')}>{t('Cancel order')}</Button>
        </div>
      )}
    </div>
  );
}

/** Packaging orders to pack and send out. On the floor it shows only this facility's orders. */
export function PackagingOrders({ hubId, couriersPath }: { hubId?: string; couriersPath: string }) {
  const t = useT();
  const [status, setStatus] = useState('');
  const list = useLoad<PackOrder[]>(`/shop/orders${status ? `?status=${status}` : ''}`);
  const couriers = useLoad<{ id: string; name: string; role?: string }[]>(couriersPath);
  const people = (couriers.data ?? []).filter((c) => !c.role || c.role === 'COURIER');
  const rows = (list.data ?? []).filter((o) => !hubId || o.hubId === hubId);
  return (
    <div className="space-y-4">
      <div className="ms-auto w-56">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('Open orders')}</option>
          <option value="DELIVERED">{t('Delivered')}</option>
          <option value="CANCELLED">{t('Cancelled')}</option>
        </Select>
      </div>
      {!list.data ? <Loading /> : rows.length === 0 ? <Card><Empty>{t('No packaging orders')}</Empty></Card> : rows.map((o) => (
        <Card key={o.id}>
          <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="ltr-iso font-bold">{o.code}</span>
                <Badge tone={PACK_STATUS[o.status]?.[1] ?? 'slate'}>{t(PACK_STATUS[o.status]?.[0] ?? o.status)}</Badge>
                <Badge tone={o.payment === 'CASH' ? 'amber' : 'slate'}>{o.payment === 'CASH' ? t('Cash at delivery') : t('From the balance')}</Badge>
              </div>
              <p className="mt-2 font-semibold">{o.merchant?.name}</p>
              <p className="text-caption text-text-muted">{o.merchant?.pickupAddress} · <a href={`tel:${o.merchant?.phone}`} className="ltr-iso">{o.merchant?.phone}</a></p>
              {o.notes && <p className="mt-1 text-caption">{o.notes}</p>}
              <p className="mt-1 text-caption text-text-muted">{dateTime(o.createdAt)}{o.courier ? ` · ${o.courier}` : ''}{o.cancelReason ? ` · ${o.cancelReason}` : ''}</p>
            </div>
            <ul className="space-y-1 text-body-sm">
              {o.lines.map((l) => <li key={l.id}><span className="tabular font-bold">{l.qty} ×</span> {l.product.name} <span className="text-caption text-text-muted">{l.product.unit}</span></li>)}
              <li className="pt-1 text-caption text-text-muted">{t('Total')}: <span className="tabular font-semibold text-text">{egp(o.total)}</span>{o.deliveryFee ? ` (${t('delivery')} ${egp(o.deliveryFee)})` : ''}</li>
            </ul>
            <Actions o={o} couriers={people} onDone={() => void list.reload()} />
          </div>
        </Card>
      ))}
    </div>
  );
}

'use client';
import { useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { PACK_STATUS } from '@/parcels/components/PackagingOrders';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';

interface Item { id: string; sku: string; name: string; nameAr: string; description: string; unit: string; price: number; available: number; hasPhoto: boolean }
interface Shop { open: boolean; deliveryFee: number; freeDeliveryFrom: number; balance: number; items: Item[] }
interface Order {
  id: string; code: string; status: string; payment: string; goodsTotal: number; deliveryFee: number; total: number; createdAt: string; deliveredAt: string | null; cancelReason: string;
  lines: { id: string; qty: number; unitPrice: number; product: { name: string; nameAr: string; unit: string } }[];
}

/** Packaging from Shiply's stock, delivered to the pickup address; paid from the balance or in cash. */
export default function ShopPage() {
  const t = useT();
  const locale = useLocale();
  const shop = useLoad<Shop>('/merchant/shop');
  const orders = useLoad<Order[]>('/merchant/shop/orders');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<'WALLET' | 'CASH'>('CASH');
  const [notes, setNotes] = useState('');
  const r = useRunner(async () => {
    await Promise.all([shop.reload(), orders.reload()]);
  });

  if (!shop.data) return shop.error ? <Alert>{t(shop.error)}</Alert> : <Loading />;
  const s = shop.data;
  const name = (i: { name: string; nameAr: string }) => (locale === 'ar' && i.nameAr ? i.nameAr : i.name);
  const chosen = s.items.filter((i) => (cart[i.id] ?? 0) > 0);
  const goods = chosen.reduce((sum, i) => sum + i.price * cart[i.id]!, 0);
  const free = s.freeDeliveryFrom > 0 && goods >= s.freeDeliveryFrom;
  const delivery = chosen.length ? (free ? 0 : s.deliveryFee) : 0;
  const total = goods + delivery;
  const set = (id: string, n: number, max: number) => setCart({ ...cart, [id]: Math.max(0, Math.min(max, n)) });

  return (
    <div className="space-y-5">
      <PageHeader title={t('Packaging shop')} subtitle={t('Flyers, boxes and tape from our stock, delivered to your pickup address')} />
      {!s.open && <Alert tone="warning">{t('The packaging shop is closed right now')}</Alert>}
      {r.view}
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {s.items.length === 0 ? <Card><Empty>{t('Nothing for sale yet')}</Empty></Card> : s.items.map((i) => {
            const n = cart[i.id] ?? 0;
            return (
              <Card key={i.id}>
                {i.hasPhoto ? (
                  <img src={`/api/parcels/shop/products/${i.id}/photo`} alt="" className="mb-3 aspect-[4/3] w-full rounded-lg object-cover" />
                ) : <div className="mb-3 grid aspect-[4/3] w-full place-items-center rounded-lg bg-surface-raised text-caption text-text-muted">{i.sku}</div>}
                <p className="font-semibold">{name(i)}</p>
                <p className="text-caption text-text-muted">{i.unit}{i.description ? ` · ${i.description}` : ''}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="tabular text-h3">{egp(i.price)}</span>
                  {i.available === 0 ? <Badge tone="red">{t('Out of stock')}</Badge> : i.available < 20 ? <Badge tone="amber">{t('{n} left', { n: i.available })}</Badge> : null}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button tone="secondary" disabled={n === 0} onClick={() => set(i.id, n - 1, i.available)} aria-label={t('Less')}>−</Button>
                  <Input inputMode="numeric" className="w-16 text-center" value={String(n)} onChange={(e) => set(i.id, Number(e.target.value.replace(/\D/g, '')) || 0, i.available)} />
                  <Button tone="secondary" disabled={n >= i.available || !s.open} onClick={() => set(i.id, n + 1, i.available)} aria-label={t('More')}>+</Button>
                </div>
              </Card>
            );
          })}
        </div>

        <Card title={t('Your order')} className="h-fit lg:sticky lg:top-4">
          {chosen.length === 0 ? <p className="text-body-sm text-text-muted">{t('Choose what you need')}</p> : (
            <ul className="space-y-1 text-body-sm">
              {chosen.map((i) => <li key={i.id} className="flex justify-between gap-2"><span>{cart[i.id]} × {name(i)}</span><span className="tabular">{egp(i.price * cart[i.id]!)}</span></li>)}
            </ul>
          )}
          <div className="mt-3 space-y-1 border-t border-border pt-3 text-body-sm">
            <div className="flex justify-between"><span>{t('Delivery')}</span><span className="tabular">{chosen.length ? (free ? t('Free') : egp(delivery)) : egp(0)}</span></div>
            {s.freeDeliveryFrom > 0 && !free && <p className="text-caption text-text-muted">{t('Free delivery from {amount}', { amount: egp(s.freeDeliveryFrom) })}</p>}
            <div className="flex justify-between text-h3"><span>{t('Total')}</span><span className="tabular">{egp(total)}</span></div>
            <p className="text-caption text-text-muted">{t('VAT included')}</p>
          </div>
          <Field label={t('How will you pay?')}>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-body-sm"><input type="radio" checked={payment === 'CASH'} onChange={() => setPayment('CASH')} />{t('Cash to the courier at delivery')}</label>
              <label className="flex items-center gap-2 text-body-sm"><input type="radio" checked={payment === 'WALLET'} disabled={s.balance < total} onChange={() => setPayment('WALLET')} />{t('From my balance ({amount})', { amount: egp(s.balance) })}</label>
            </div>
          </Field>
          <Field label={t('Notes')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Best time to deliver')} /></Field>
          <Button className="mt-3 w-full" disabled={r.busy || !s.open || chosen.length === 0 || (payment === 'WALLET' && s.balance < total)} onClick={() => void r.run(async () => {
            await api('/merchant/shop/orders', { body: { payment, notes, lines: chosen.map((i) => ({ productId: i.id, qty: cart[i.id] })) } });
            setCart({});
            setNotes('');
          }, 'Order placed. We will send you a code by SMS when it is on its way')}>{t('Place order')}</Button>
        </Card>
      </div>

      <Card title={t('My packaging orders')}>
        {!orders.data ? <Loading /> : orders.data.length === 0 ? <Empty>{t('No orders yet')}</Empty> : (
          <ul className="divide-y divide-border">
            {orders.data.map((o) => (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2"><span className="ltr-iso font-bold">{o.code}</span><Badge tone={PACK_STATUS[o.status]?.[1] ?? 'slate'}>{t(PACK_STATUS[o.status]?.[0] ?? o.status)}</Badge></div>
                  <p className="text-caption text-text-muted">{dateTime(o.createdAt)} · {o.payment === 'CASH' ? t('Cash at delivery') : t('From the balance')}{o.cancelReason ? ` · ${o.cancelReason}` : ''}</p>
                  <p className="text-body-sm">{o.lines.map((l) => `${l.qty} × ${name(l.product)}`).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular font-semibold">{egp(o.total)}</span>
                  {o.status === 'PLACED' && <Button tone="secondary" disabled={r.busy} onClick={() => void r.call(`/merchant/shop/orders/${o.id}/cancel`, {}, 'Cancelled')}>{t('Cancel')}</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

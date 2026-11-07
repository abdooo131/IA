'use client';
import Link from 'next/link';
import { useState } from 'react';
import { MoneyInput, toPiastres, useRunner } from '@/parcels/components/money';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
} from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Product {
  id: string;
  sku: string;
  name: string;
  unit: string;
  cost: number;
  active: boolean;
}
interface Supplier {
  id: string;
  name: string;
  active: boolean;
}
interface Po {
  id: string;
  code: string;
  status: string;
  expectedOn: string | null;
  notes: string;
  net: number;
  billId: string | null;
  createdAt: string;
  orderedAt: string | null;
  receivedAt: string | null;
  supplier: { name: string };
  lines: {
    id: string;
    qty: number;
    unitCost: number;
    receivedQty: number;
    product: { sku: string; name: string; unit: string };
  }[];
}

const STATUS: Record<string, [string, 'amber' | 'blue' | 'green' | 'slate']> = {
  DRAFT: ['Draft', 'slate'],
  ORDERED: ['Sent to the supplier', 'amber'],
  RECEIVED: ['Received', 'green'],
  CANCELLED: ['Cancelled', 'slate'],
};

function NewPo({ onDone }: { onDone: () => void }) {
  const t = useT();
  const suppliers = useLoad<Supplier[]>('/finance/suppliers');
  const products = useLoad<Product[]>('/shop/products');
  const [supplierId, setSupplierId] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ productId: '', qty: '', cost: '' }]);
  const r = useRunner(onDone);
  const net = lines.reduce((s, l) => {
    const c = Number(l.cost) * 100;
    return s + (Number(l.qty) || 0) * (Number.isFinite(c) ? c : 0);
  }, 0);
  return (
    <Card title={t('New purchase order')}>
      {r.view}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Field label={t('Supplier')}>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('Choose')}</option>
              {suppliers.data
                ?.filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Link
            href="/parcels/admin/money/suppliers"
            className="text-caption font-semibold text-link"
          >
            {t('Add a supplier')}
          </Link>
        </div>
        <Field label={t('Expected on')}>
          <Input
            type="date"
            value={expectedOn}
            onChange={(e) => setExpectedOn(e.target.value)}
            className="ltr-iso"
          />
        </Field>
        <Field label={t('Notes')}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_7rem_10rem_auto]">
            <Select
              value={l.productId}
              onChange={(e) => {
                const p = products.data?.find((x) => x.id === e.target.value);
                setLines(
                  lines.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          productId: e.target.value,
                          cost: x.cost || (p?.cost ? String(p.cost / 100) : ''),
                        }
                      : x,
                  ),
                );
              }}
            >
              <option value="">{t('Product')}</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.unit}
                </option>
              ))}
            </Select>
            <Input
              inputMode="numeric"
              placeholder={t('Quantity')}
              value={l.qty}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x,
                  ),
                )
              }
            />
            <MoneyInput
              placeholder={t('Unit cost before VAT')}
              value={l.cost}
              onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: v } : x)))}
            />
            <Button
              tone="secondary"
              disabled={lines.length === 1}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              {t('Remove')}
            </Button>
          </div>
        ))}
        <button
          type="button"
          className="text-body-sm font-semibold text-link"
          onClick={() => setLines([...lines, { productId: '', qty: '', cost: '' }])}
        >
          {t('Add a line')}
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-body-sm">
          {t('Total before VAT')}: <span className="tabular font-bold">{egp(net)}</span>
        </span>
        <Button
          disabled={r.busy || !supplierId || lines.some((l) => !l.productId || !l.qty || !l.cost)}
          onClick={() =>
            void r.run(async () => {
              await api('/shop/purchase-orders', {
                body: {
                  supplierId,
                  expectedOn: expectedOn || null,
                  notes,
                  lines: lines.map((l) => ({
                    productId: l.productId,
                    qty: Number(l.qty),
                    unitCost: Number(l.cost) === 0 ? 0 : toPiastres(l.cost),
                  })),
                },
              });
            }, 'Purchase order saved as a draft')
          }
        >
          {t('Save draft')}
        </Button>
      </div>
    </Card>
  );
}

function Receive({ po, onDone }: { po: Po; onDone: () => void }) {
  const t = useT();
  const r = useRunner(onDone);
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(po.lines.map((l) => [l.id, String(l.qty - l.receivedQty)])),
  );
  const [number, setNumber] = useState('');
  const [vat, setVat] = useState(true);
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-surface-raised p-4">
      {r.view}
      <p className="text-body-sm font-semibold">{t('What arrived?')}</p>
      {po.lines.map((l) => (
        <div key={l.id} className="flex items-center gap-3 text-body-sm">
          <Input
            inputMode="numeric"
            className="w-24"
            value={qty[l.id] ?? ''}
            onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/\D/g, '') })}
          />
          <span>
            {l.product.name} · {t('{n} still expected', { n: l.qty - l.receivedQty })}
          </span>
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Supplier invoice number')}>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-body-sm">
          <input type="checkbox" checked={vat} onChange={(e) => setVat(e.target.checked)} />
          {t('The supplier charges VAT')}
        </label>
      </div>
      <p className="text-caption text-text-muted">
        {t(
          'The stock goes up now. A bill for the supplier is raised and books when a second person approves it.',
        )}
      </p>
      <Button
        disabled={r.busy}
        onClick={() =>
          void r.call(
            `/shop/purchase-orders/${po.id}/receive`,
            {
              lines: po.lines.map((l) => ({ lineId: l.id, qty: Number(qty[l.id] || 0) })),
              number,
              vat,
            },
            'Stock updated. The bill waits for approval',
          )
        }
      >
        {t('Receive')}
      </Button>
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const t = useT();
  const list = useLoad<Po[]>('/shop/purchase-orders');
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);
  const r = useRunner(() => list.reload());
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Purchase orders')}
        subtitle={t(
          'Buy packaging from suppliers. Receiving the goods adds the stock and raises the supplier bill',
        )}
        actions={<Button onClick={() => setAdding(!adding)}>{t('New purchase order')}</Button>}
      />
      {adding && (
        <NewPo
          onDone={() => {
            setAdding(false);
            void list.reload();
          }}
        />
      )}
      {r.view}
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Card>
          <Empty>{t('No purchase orders yet')}</Empty>
        </Card>
      ) : (
        list.data.map((po) => (
          <Card key={po.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="ltr-iso font-bold">{po.code}</span>
                  <Badge tone={STATUS[po.status]?.[1] ?? 'slate'}>
                    {t(STATUS[po.status]?.[0] ?? po.status)}
                  </Badge>
                </div>
                <p className="mt-1 font-semibold">{po.supplier.name}</p>
                <p className="text-caption text-text-muted">
                  {dateTime(po.createdAt)}
                  {po.expectedOn ? ` · ${t('Expected on')} ${po.expectedOn}` : ''}
                  {po.notes ? ` · ${po.notes}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {po.status === 'DRAFT' && (
                  <Button
                    disabled={r.busy}
                    onClick={() =>
                      void r.call(
                        `/shop/purchase-orders/${po.id}/order`,
                        {},
                        'Marked as sent to the supplier',
                      )
                    }
                  >
                    {t('Sent to the supplier')}
                  </Button>
                )}
                {po.status === 'ORDERED' && (
                  <Button onClick={() => setReceiving(receiving === po.id ? null : po.id)}>
                    {t('Receive goods')}
                  </Button>
                )}
                {(po.status === 'DRAFT' ||
                  (po.status === 'ORDERED' && po.lines.every((l) => l.receivedQty === 0))) && (
                  <Button
                    tone="secondary"
                    disabled={r.busy}
                    onClick={() =>
                      void r.call(`/shop/purchase-orders/${po.id}/cancel`, {}, 'Cancelled')
                    }
                  >
                    {t('Cancel')}
                  </Button>
                )}
                {po.billId && (
                  <Link href="/parcels/admin/money/bills" className="btn-secondary">
                    {t('Bills')}
                  </Link>
                )}
              </div>
            </div>
            <ul className="mt-3 space-y-1 text-body-sm">
              {po.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-3">
                  <span className="tabular font-bold">
                    {l.receivedQty}/{l.qty}
                  </span>
                  <span>
                    {l.product.name} · {l.product.unit}
                  </span>
                  <span className="tabular text-text-muted">
                    {egp(l.unitCost)} {t('each before VAT')}
                  </span>
                </li>
              ))}
              <li className="text-caption text-text-muted">
                {t('Total before VAT')}:{' '}
                <span className="tabular font-semibold text-text">{egp(po.net)}</span>
              </li>
            </ul>
            {receiving === po.id && (
              <Receive
                po={po}
                onDone={() => {
                  setReceiving(null);
                  void list.reload();
                }}
              />
            )}
          </Card>
        ))
      )}
    </div>
  );
}

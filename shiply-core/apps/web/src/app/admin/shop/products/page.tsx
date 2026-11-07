'use client';
import { Fragment, useState } from 'react';
import { MoneyInput, toPiastres, useRunner } from '@/components/money';
import { PhotoButton, photoBody } from '@/components/PhotoButton';
import { Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Product { id: string; sku: string; name: string; nameAr: string; description: string; unit: string; price: number; cost: number; stock: number; minStock: number; active: boolean; photoMime: string }
interface Move { id: string; kind: string; qty: number; unitCost: number; ref: string; note: string; createdAt: string }

const blank = { sku: '', name: '', nameAr: '', description: '', unit: '', price: '', minStock: '0', active: true };

function Moves({ id }: { id: string }) {
  const t = useT();
  const moves = useLoad<Move[]>(`/shop/products/${id}/moves`);
  if (!moves.data) return <Loading />;
  if (moves.data.length === 0) return <p className="text-caption text-text-muted">{t('No stock changes yet')}</p>;
  return (
    <ul className="max-h-60 space-y-1 overflow-y-auto text-caption">
      {moves.data.map((m) => (
        <li key={m.id} className="flex gap-3">
          <span className="w-32 shrink-0 text-text-muted">{dateTime(m.createdAt)}</span>
          <span className={m.qty > 0 ? 'tabular font-bold text-status-delivered' : 'tabular font-bold text-danger'}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
          <span>{t(m.kind)}</span>
          <span className="ltr-iso text-text-muted">{m.ref}</span>
          <span className="truncate">{m.note}</span>
        </li>
      ))}
    </ul>
  );
}

function Count({ p, onDone }: { p: Product; onDone: () => void }) {
  const t = useT();
  const r = useRunner(onDone);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  return (
    <div className="space-y-2">
      {r.view}
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
        <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d-]/g, ''))} placeholder={t('+5 or -3')} className="ltr-iso" />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Why did the count change?')} />
        <Button tone="secondary" disabled={r.busy || !qty || qty === '-' || note.trim().length < 3} onClick={() => void r.call(`/shop/products/${p.id}/adjust`, { qty: Number(qty), note }, 'Stock updated')}>{t('Correct the count')}</Button>
      </div>
      <Moves id={p.id} />
    </div>
  );
}

/** What the shop sells: prices, what is on the shelf, what it cost us, and the counts. */
export default function ProductsPage() {
  const t = useT();
  const list = useLoad<Product[]>('/shop/products');
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [photo, setPhoto] = useState<string | null>(null);
  const r = useRunner(() => list.reload());

  const edit = (p: Product | null) => {
    setEditing(p ? p.id : 'new');
    setPhoto(null);
    setForm(p ? { sku: p.sku, name: p.name, nameAr: p.nameAr, description: p.description, unit: p.unit, price: String(p.price / 100), minStock: String(p.minStock), active: p.active } : blank);
  };
  const save = () => r.run(async () => {
    const body = { ...form, price: toPiastres(form.price), minStock: Number(form.minStock) || 0, ...(photo ? { photo: photoBody(photo) } : {}) };
    await api(editing === 'new' ? '/shop/products' : `/shop/products/${editing}`, { method: editing === 'new' ? 'POST' : 'PUT', body });
    setEditing(null);
  }, 'Saved');

  const value = (list.data ?? []).reduce((s, p) => s + Math.max(0, p.stock) * p.cost, 0);
  return (
    <div className="space-y-5">
      <PageHeader title={t('Products and stock')} subtitle={t('Stock value at cost: {amount}', { amount: egp(value) })} actions={<Button onClick={() => edit(null)}>{t('New product')}</Button>} />
      {r.view}
      {editing && (
        <Card title={editing === 'new' ? t('New product') : t('Edit product')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('Code')}><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} className="ltr-iso" /></Field>
            <Field label={t('Name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('Name in Arabic')}><Input dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></Field>
            <Field label={t('Unit')} hint={t('For example Pack of 50')}><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
            <Field label={t('Price to merchants (EGP)')} hint={t('VAT included')}><MoneyInput value={form.price} onChange={(v) => setForm({ ...form, price: v })} /></Field>
            <Field label={t('Low stock alert at')}><Input inputMode="numeric" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Description')}><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label={t('Photo')}><PhotoButton value={photo} onChange={setPhoto} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-body-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />{t('Sold in the shop')}</label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button disabled={r.busy} onClick={() => void save()}>{t('Save')}</Button>
            <Button tone="secondary" onClick={() => setEditing(null)}>{t('Cancel')}</Button>
          </div>
        </Card>
      )}
      <Card>
        {!list.data ? <Loading /> : list.data.length === 0 ? <Empty>{t('No products yet')}</Empty> : (
          <Table head={[t('Product'), t('Price'), t('Our cost'), t('In stock'), '']}>
            {list.data.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  <Td>
                    <div className="flex items-center gap-3">
                      {p.photoMime ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/shop/products/${p.id}/photo`} alt="" className="h-10 w-10 rounded-md object-cover" />
                      ) : <span className="h-10 w-10 rounded-md bg-surface-raised" />}
                      <div>
                        <span className="font-semibold">{p.name}</span> {!p.active && <Badge>{t('Hidden')}</Badge>}
                        <div className="text-caption text-text-muted"><span className="ltr-iso">{p.sku}</span> · {p.unit}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="tabular">{egp(p.price)}</Td>
                  <Td className="tabular">{egp(p.cost)}</Td>
                  <Td>{p.minStock > 0 && p.stock <= p.minStock ? <Badge tone="red">{p.stock}</Badge> : <span className="tabular font-bold">{p.stock}</span>}</Td>
                  <Td>
                    <div className="flex gap-3">
                      <button type="button" className="text-caption font-bold text-link" onClick={() => edit(p)}>{t('Edit')}</button>
                      <button type="button" className="text-caption font-bold text-link" onClick={() => setOpen(open === p.id ? null : p.id)}>{t('Stock')}</button>
                    </div>
                  </Td>
                </tr>
                {open === p.id && (
                  <tr><td colSpan={5} className="bg-surface-raised p-4"><Count p={p} onDone={() => void list.reload()} /></td></tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Supplier { id: string; name: string; taxId: string; phone: string; email: string; bankName: string; iban: string; active: boolean; owed: number }
const empty = { name: '', taxId: '', phone: '', email: '', bankName: '', iban: '', active: true };

export default function SuppliersPage() {
  const t = useT();
  const list = useLoad<Supplier[]>('/finance/suppliers');
  const r = useRunner(() => list.reload());
  const [editing, setEditing] = useState<string | null>(null);
  const [f, setF] = useState(empty);
  if (!list.data) return <Loading />;
  const open = (s: Supplier | null) => {
    setEditing(s?.id ?? 'new');
    setF(s ? { name: s.name, taxId: s.taxId, phone: s.phone, email: s.email, bankName: s.bankName, iban: s.iban, active: s.active } : empty);
  };
  return (
    <div className="space-y-5">
      <PageHeader title={t('Suppliers')} subtitle={t('Who we buy from, and what we owe each one')} actions={<Button onClick={() => (editing ? setEditing(null) : open(null))}>{editing ? t('Close') : t('Add supplier')}</Button>} />
      {r.view}
      {editing && (
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(() => api(editing === 'new' ? '/finance/suppliers' : `/finance/suppliers/${editing}`, { method: editing === 'new' ? 'POST' : 'PUT', body: f }), 'Saved').then((ok) => ok && setEditing(null));
            }}
          >
            <Field label={t('Name')}><Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label={t('Tax registration number')}><Input className="ltr-iso" value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></Field>
            <Field label={t('Phone')}><Input className="ltr-iso" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label={t('Email')}><Input type="email" className="ltr-iso" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label={t('Bank')}><Input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
            <Field label="IBAN"><Input className="ltr-iso" value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t('Active')}</label>
            <div className="sm:col-span-2 lg:col-span-3"><Button type="submit">{t('Save')}</Button></div>
          </form>
        </Card>
      )}
      <Card>
        {list.data.length === 0 ? <Empty>{t('No suppliers yet')}</Empty> : (
          <Table head={[t('Name'), t('Tax registration number'), t('Phone'), t('We owe'), '']}>
            {list.data.map((s) => (
              <tr key={s.id}>
                <Td>{s.name}{!s.active && <span className="ms-2"><Badge tone="red">{t('Inactive')}</Badge></span>}</Td>
                <Td><span className="ltr-iso">{s.taxId}</span></Td>
                <Td><span className="ltr-iso">{s.phone}</span></Td>
                <Td><span className="font-bold">{egp(s.owed)}</span></Td>
                <Td><Button tone="ghost" onClick={() => open(s)}>{t('Edit')}</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

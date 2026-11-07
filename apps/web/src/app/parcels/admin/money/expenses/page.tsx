'use client';
import { useState } from 'react';
import { useMe } from '@/parcels/components/Shell';
import { MoneyInput, RequestBadge, readFile, toPiastres, useRunner, type FileBody } from '@/parcels/components/money';
import { Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { egp, todayCairo } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';

interface Account { code: string; name: string; nameAr: string; type: string; active: boolean }
interface Expense { id: string; code: string; date: string; accountCode: string; accountName: string; accountNameAr: string; amount: number; paidFrom: string; supplier: string; note: string; status: string; receiptMime: string; createdById: string }

export default function ExpensesPage() {
  const t = useT();
  const locale = useLocale();
  const me = useMe();
  const accounts = useLoad<Account[]>('/finance/accounts');
  const hubs = useLoad<{ id: string; code: string; name: string }[]>('/reference/hubs');
  const list = useLoad<Expense[]>('/finance/expenses');
  const r = useRunner(() => Promise.all([list.reload(), accounts.reload()]));
  const [f, setF] = useState({ date: todayCairo(), accountCode: '5210', amount: '', paidFrom: 'BANK', hubId: '', supplier: '', note: '' });
  const [receipt, setReceipt] = useState<FileBody | null>(null);
  const [acc, setAcc] = useState({ code: '', name: '', nameAr: '' });
  if (!accounts.data || !list.data) return <Loading />;
  const expenseAccounts = accounts.data.filter((a) => a.type === 'EXPENSE' && a.active);
  const name = (a: { name: string; nameAr: string }) => (locale === 'ar' ? a.nameAr : a.name);

  return (
    <div className="space-y-5">
      <PageHeader title={t('Expenses')} subtitle={t('Rent, fuel, supplies and other costs. Booked when a second person approves.')} />
      {r.view}
      <Card title={t('New expense')}>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(async () => {
              await api('/finance/expenses', { body: { ...f, amount: toPiastres(f.amount), hubId: f.hubId || null, receipt } });
              setF({ ...f, amount: '', supplier: '', note: '' });
              setReceipt(null);
            }, 'Expense saved. Someone else must approve it');
          }}
        >
          <Field label={t('Date')}><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="ltr-iso" /></Field>
          <Field label={t('Account')}>
            <Select value={f.accountCode} onChange={(e) => setF({ ...f, accountCode: e.target.value })}>
              {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {name(a)}</option>)}
            </Select>
          </Field>
          <Field label={t('Amount (EGP)')}><MoneyInput required value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label={t('Paid from')}>
            <Select value={f.paidFrom} onChange={(e) => setF({ ...f, paidFrom: e.target.value })}>
              <option value="BANK">{t('Bank')}</option>
              <option value="HUB_SAFE">{t('A hub safe')}</option>
            </Select>
          </Field>
          {f.paidFrom === 'HUB_SAFE' && (
            <Field label={t('Hub')}>
              <Select required value={f.hubId} onChange={(e) => setF({ ...f, hubId: e.target.value })}>
                <option value="">{t('Choose a hub')}</option>
                {(hubs.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.code} · {h.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label={t('Supplier')}><Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
          <Field label={t('Notes')}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <Field label={t('Receipt')} hint={receipt?.fileName}>
            <label className="btn-secondary cursor-pointer">
              {receipt ? t('Change file') : t('Upload file')}
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void readFile(file).then(setReceipt).catch((err) => r.setMsg({ ok: false, text: t(String(err.message)) })); }} />
            </label>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" disabled={r.busy}>{t('Save expense')}</Button></div>
        </form>
      </Card>
      <Card title={t('Expenses')}>
        {list.data.length === 0 ? (
          <Empty>{t('No expenses yet')}</Empty>
        ) : (
          <Table head={[t('Expense'), t('Date'), t('Account'), t('Amount'), t('Supplier'), t('Status'), '']}>
            {list.data.map((x) => (
              <tr key={x.id}>
                <Td><span className="ltr-iso font-bold">{x.code}</span>{x.receiptMime && <a className="ms-2 text-caption font-bold text-link" href={`/api/parcels/finance/expenses/${x.id}/receipt`} target="_blank" rel="noreferrer">{t('Receipt')}</a>}</Td>
                <Td><span className="ltr-iso">{x.date}</span></Td>
                <Td>{locale === 'ar' ? x.accountNameAr : x.accountName}</Td>
                <Td><span className="font-bold">{egp(x.amount)}</span><div className="text-caption text-text-muted">{x.paidFrom === 'HUB_SAFE' ? t('A hub safe') : t('Bank')}</div></Td>
                <Td>{x.supplier}<div className="text-caption text-text-muted">{x.note}</div></Td>
                <Td><RequestBadge status={x.status} posted /></Td>
                <Td>
                  {x.status === 'PENDING_APPROVAL' && (x.createdById === me.id ? <span className="text-caption text-text-muted">{t('Someone else approves')}</span> : (
                    <div className="flex gap-1">
                      <Button onClick={() => void r.call(`/finance/expenses/${x.id}/approve`, {}, 'Approved and booked')}>{t('Approve')}</Button>
                      <Button tone="ghost" onClick={() => void r.call(`/finance/expenses/${x.id}/reject`, {}, 'Rejected')}>{t('Reject')}</Button>
                    </div>
                  ))}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={t('Add an expense account')}>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void r.call('/finance/accounts', acc, 'Account added').then((ok) => ok && setAcc({ code: '', name: '', nameAr: '' })); }}>
          <Field label={t('Code')} hint={t('4 digits starting with 5')}><Input required className="ltr-iso w-24" value={acc.code} onChange={(e) => setAcc({ ...acc, code: e.target.value })} /></Field>
          <Field label={t('Name in English')}><Input required value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} /></Field>
          <Field label={t('Name in Arabic')}><Input required dir="rtl" value={acc.nameAr} onChange={(e) => setAcc({ ...acc, nameAr: e.target.value })} /></Field>
          <Button type="submit" tone="secondary">{t('Add account')}</Button>
        </form>
      </Card>
    </div>
  );
}

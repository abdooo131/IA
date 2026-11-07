'use client';
import { useState } from 'react';
import { useMe } from '@/components/Shell';
import { RequestBadge, useRunner } from '@/components/money';
import { Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { DAY_NAMES } from '@/components/workforce';
import { api } from '@/lib/api';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Bal {
  merchantId: string;
  code: string;
  name: string;
  parcels: number;
  codTotal: number;
  feesTotal: number;
  ready: number;
  payoutFee: number;
  net: number;
  ledgerBalance: number;
  payoutDays: number[];
  dueToday: boolean;
  hasBank: boolean;
  bankChangePending: boolean;
  bankName: string;
  iban: string;
}
interface Payout {
  id: string;
  code: string;
  amount: number;
  codTotal: number;
  feesTotal: number;
  payoutFee: number;
  status: string;
  iban: string;
  bankName: string;
  reference: string;
  createdById: string;
  createdAt: string;
  merchant: { name: string; code: string };
  _count: { shipments: number };
}
interface Inbox { bankChanges: { merchantId: string; name: string; pending: { bankName: string; bankAccountName: string; iban: string }; mine: boolean }[] }

export default function PayoutsPage() {
  const t = useT();
  const me = useMe();
  const balances = useLoad<Bal[]>('/finance/merchants');
  const [status, setStatus] = useState('');
  const payouts = useLoad<Payout[]>(`/finance/payouts${status ? `?status=${status}` : ''}`);
  const inbox = useLoad<Inbox>('/finance/inbox');
  const reloadAll = () => Promise.all([balances.reload(), payouts.reload(), inbox.reload()]);
  const r = useRunner(reloadAll);
  const [bankFor, setBankFor] = useState<string | null>(null);
  const [bank, setBank] = useState({ bankName: '', bankAccountName: '', iban: '' });
  const [daysFor, setDaysFor] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>([]);

  if (!balances.data || !payouts.data) return <Loading />;
  const due = balances.data.filter((b) => b.dueToday && b.hasBank && !b.bankChangePending && b.net > 0);

  const download = async () => {
    const res = await fetch('/api/finance/bank-file', { credentials: 'same-origin' });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bank-transfers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Money')}
        title={t('Merchant payouts')}
        subtitle={t('Cash collected minus our fees, paid on each merchant’s payout days. One person creates, another approves.')}
        actions={
          <div className="flex gap-2">
            <Button tone="secondary" onClick={() => void download()}>{t('Bank file (CIB)')}</Button>
            <Button disabled={due.length === 0 || r.busy} onClick={() => void r.run(async () => { const x = await api<{ made: string[] }>('/finance/payouts/due', { body: {} }); if (!x.made.length) throw new Error('Nothing was created'); }, 'Payouts created for today')}>
              {t('Create today’s payouts ({count})', { count: due.length })}
            </Button>
          </div>
        }
      />
      {r.view}
      {(inbox.data?.bankChanges ?? []).length > 0 && (
        <Card title={t('Bank account changes waiting')}>
          <ul className="divide-y divide-line">
            {inbox.data!.bankChanges.map((b) => (
              <li key={b.merchantId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-bold">{b.name}</p>
                  <p className="ltr-iso text-caption text-text-muted">{b.pending.bankName} · {b.pending.bankAccountName} · {b.pending.iban}</p>
                </div>
                {b.mine ? (
                  <span className="text-caption text-text-muted">{t('You asked for this change; someone else approves it')}</span>
                ) : (
                  <div className="flex gap-1">
                    <Button onClick={() => void r.call(`/finance/merchants/${b.merchantId}/bank/approve`, {}, 'Bank account changed')}>{t('Approve')}</Button>
                    <Button tone="ghost" onClick={() => void r.call(`/finance/merchants/${b.merchantId}/bank/reject`, {}, 'Change rejected')}>{t('Reject')}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={t('Ready to pay')}>
        <Table head={[t('Merchant'), t('Parcels'), t('Collected'), t('Fees'), t('To pay'), t('Payout days'), t('Bank'), '']}>
          {balances.data.map((b) => (
            <tr key={b.merchantId}>
              <Td>
                <span className="font-bold">{b.name}</span>
                {b.dueToday && b.net > 0 && <span className="ms-2"><Badge tone="lime">{t('Due today')}</Badge></span>}
                <div className="text-caption text-text-muted">{t('All owed, incl. cash with couriers')}: {egp(b.ledgerBalance)}</div>
              </Td>
              <Td>{b.parcels}</Td>
              <Td>{egp(b.codTotal)}</Td>
              <Td>{egp(b.feesTotal)}{b.payoutFee > 0 && <div className="text-caption text-text-muted">+ {egp(b.payoutFee)} {t('cash out fee')}</div>}</Td>
              <Td><span className="font-bold">{egp(b.net)}</span></Td>
              <Td>
                {daysFor === b.merchantId ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {DAY_NAMES.map((d, i) => (
                      <label key={d} className={`cursor-pointer rounded border px-1.5 text-caption ${days.includes(i) ? 'border-accent font-bold' : 'border-line'}`}>
                        <input type="checkbox" className="sr-only" checked={days.includes(i)} onChange={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} />
                        {t(d)}
                      </label>
                    ))}
                    <Button onClick={() => void r.call(`/finance/merchants/${b.merchantId}/payout-days`, { payoutDays: days }, 'Saved').then((ok) => ok && setDaysFor(null))}>{t('Save')}</Button>
                  </div>
                ) : (
                  <button type="button" className="text-link" onClick={() => { setDaysFor(b.merchantId); setDays(b.payoutDays); }}>
                    {b.payoutDays.map((d) => t(DAY_NAMES[d]!)).join(' ')}
                  </button>
                )}
              </Td>
              <Td>
                {b.hasBank ? <span className="ltr-iso text-caption">{b.bankName} {b.iban}</span> : <Badge tone="red">{t('No bank account')}</Badge>}
                {b.bankChangePending && <div><Badge tone="amber">{t('Change waiting')}</Badge></div>}
                <div>
                  <button type="button" className="text-caption font-bold text-link" onClick={() => { setBankFor(bankFor === b.merchantId ? null : b.merchantId); setBank({ bankName: '', bankAccountName: '', iban: '' }); }}>
                    {b.hasBank ? t('Change') : t('Add')}
                  </button>
                </div>
              </Td>
              <Td>
                <Button disabled={!b.hasBank || b.net <= 0 || b.bankChangePending} onClick={() => void r.call(`/finance/merchants/${b.merchantId}/payouts`, {}, 'Payout created. Someone else must approve it')}>{t('Create payout')}</Button>
              </Td>
            </tr>
          ))}
        </Table>
        {bankFor && (
          <form
            className="mt-4 grid gap-3 rounded-lg border border-line bg-surface-raised p-4 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(() => api(`/finance/merchants/${bankFor}/bank`, { method: 'PUT', body: bank }), 'Saved. A change to an existing account waits for a second person').then((ok) => ok && setBankFor(null));
            }}
          >
            <Field label={t('Bank')}><Input required value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} /></Field>
            <Field label={t('Account name')}><Input required value={bank.bankAccountName} onChange={(e) => setBank({ ...bank, bankAccountName: e.target.value })} /></Field>
            <Field label="IBAN"><Input required className="ltr-iso" value={bank.iban} onChange={(e) => setBank({ ...bank, iban: e.target.value })} /></Field>
            <div className="self-end"><Button type="submit">{t('Save bank account')}</Button></div>
          </form>
        )}
      </Card>
      <Card
        title={t('Payouts')}
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('All')}</option>
            <option value="PENDING_APPROVAL">{t('Waiting for approval')}</option>
            <option value="APPROVED">{t('Approved, not paid')}</option>
            <option value="PAID">{t('Paid')}</option>
            <option value="CANCELLED">{t('Cancelled')}</option>
          </Select>
        }
      >
        {payouts.data.length === 0 ? (
          <Empty>{t('No payouts yet')}</Empty>
        ) : (
          <Table head={[t('Payout'), t('Merchant'), t('Parcels'), t('Amount'), t('To'), t('Status'), '']}>
            {payouts.data.map((p) => (
              <tr key={p.id}>
                <Td><span className="ltr-iso font-bold">{p.code}</span><div className="text-caption text-text-muted">{dateTime(p.createdAt)}</div></Td>
                <Td>{p.merchant.name}</Td>
                <Td>{p._count.shipments}</Td>
                <Td><span className="font-bold">{egp(p.amount)}</span></Td>
                <Td><span className="ltr-iso text-caption">{p.bankName} {p.iban ? `•••• ${p.iban.slice(-4)}` : ''}</span>{p.reference && <div className="ltr-iso text-caption text-text-muted">{p.reference}</div>}</Td>
                <Td><RequestBadge status={p.status} /></Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {p.status === 'PENDING_APPROVAL' && p.createdById !== me.id && <Button onClick={() => void r.call(`/finance/payouts/${p.id}/approve`, {}, 'Approved')}>{t('Approve')}</Button>}
                    {p.status === 'PENDING_APPROVAL' && p.createdById === me.id && <span className="text-caption text-text-muted">{t('Someone else approves')}</span>}
                    {p.status === 'APPROVED' && (
                      <Button onClick={() => { const ref = window.prompt(t('Bank transfer reference')); if (ref !== null) void r.call(`/finance/payouts/${p.id}/paid`, { reference: ref }, 'Marked paid'); }}>{t('Mark paid')}</Button>
                    )}
                    {(p.status === 'PENDING_APPROVAL' || p.status === 'APPROVED') && <Button tone="ghost" onClick={() => void r.call(`/finance/payouts/${p.id}/cancel`, {}, 'Cancelled')}>{t('Cancel')}</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

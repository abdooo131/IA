'use client';
import { Fragment, useState } from 'react';
import { MoneyInput, RequestBadge, toPiastres, useRunner } from '@/components/money';
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Courier { id: string; name: string; phone: string; courierType: string | null; hub: string; agent: string; wallet: number; cashToHandIn: number; paidByAgent: boolean; frozen: boolean }
interface Earning { id: string; kind: string; points: number; amount: number; date: string; note: string; availableAt: string; settlementId: string | null }
interface Wallet {
  courier: { id: string; name: string };
  wallet: number;
  cashToHandIn: number;
  notYetAvailable: number;
  withdrawable: number;
  paidByAgent: boolean;
  frozen: boolean;
  unfreezeUntil: string | null;
  unfreezeReason: string;
  earnings: Earning[];
}
interface PayIn { id: string; code: string; courierName: string; amount: number; channel: string; purpose: string; reference: string; status: string; runId: string | null; createdAt: string }
interface Withdrawal { id: string; code: string; courierName: string; amount: number; method: string; status: string; createdAt: string }

const EARNING_LABEL: Record<string, string> = { DELIVERY: 'Delivery', RETURN: 'Return to merchant', PICKUP: 'Pickup', BONUS: 'Bonus', PENALTY: 'Deduction', ADJUSTMENT: 'Adjustment' };

function CourierDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const t = useT();
  const w = useLoad<Wallet>(`/finance/couriers/${id}`);
  const r = useRunner(async () => { await w.reload(); onChange(); });
  const [adj, setAdj] = useState({ kind: 'BONUS', amount: '', note: '' });
  const [reason, setReason] = useState('');
  if (!w.data) return <Loading />;
  const d = w.data;
  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface-raised p-4">
      {r.view}
      <div className="flex flex-wrap gap-6 text-body-sm">
        <div><p className="text-caption text-text-muted">{t('Wallet')}</p><p className={`text-h3 ${d.wallet < 0 ? 'text-danger' : ''}`}>{egp(d.wallet)}</p></div>
        <div><p className="text-caption text-text-muted">{t('Cash to hand in')}</p><p className="text-h3">{egp(d.cashToHandIn)}</p></div>
        <div><p className="text-caption text-text-muted">{t('Not yet available')}</p><p className="text-h3">{egp(d.notYetAvailable)}</p></div>
        <div><p className="text-caption text-text-muted">{t('Can withdraw')}</p><p className="text-h3">{d.paidByAgent ? t('Paid by agent') : egp(d.withdrawable)}</p></div>
      </div>
      {d.unfreezeUntil && <p className="text-caption">{t('Allowed to work until {time}: {reason}', { time: dateTime(d.unfreezeUntil), reason: d.unfreezeReason })}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(async () => {
              const amount = toPiastres(adj.amount);
              await api(`/finance/couriers/${id}/adjust`, { body: { kind: adj.kind, amount: adj.kind === 'PENALTY' ? -amount : amount, note: adj.note } });
              setAdj({ kind: adj.kind, amount: '', note: '' });
            }, 'Saved');
          }}
        >
          <p className="font-bold">{t('Bonus or deduction')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Select value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}>
              <option value="BONUS">{t('Bonus')}</option>
              <option value="PENALTY">{t('Deduction')}</option>
            </Select>
            <MoneyInput required value={adj.amount} onChange={(v) => setAdj({ ...adj, amount: v })} />
          </div>
          <Input required minLength={3} placeholder={t('Reason')} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
          <Button type="submit" disabled={r.busy}>{t('Save')}</Button>
        </form>
        {d.wallet < 0 && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void r.call(`/finance/couriers/${id}/unfreeze`, { reason, hours: 24 }, 'The courier can work for 24 hours'); }}>
            <p className="font-bold">{t('Let them work while the wallet is negative')}</p>
            <Input required minLength={5} placeholder={t('Reason (kept in the audit log)')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button type="submit" tone="secondary">{t('Allow for 24 hours')}</Button>
          </form>
        )}
      </div>
      <Table head={[t('Date'), t('What'), t('Points'), t('Amount'), t('Available')]}>
        {d.earnings.map((e) => (
          <tr key={e.id}>
            <Td><span className="ltr-iso">{e.date}</span></Td>
            <Td>{t(EARNING_LABEL[e.kind] ?? e.kind)}<div className="text-caption text-text-muted">{e.note}</div></Td>
            <Td>{e.points || ''}</Td>
            <Td><span className={e.amount < 0 ? 'text-danger' : ''}>{egp(e.amount)}</span></Td>
            <Td>{e.settlementId ? <Badge tone="blue">{t('Settled to agent')}</Badge> : e.amount > 0 && new Date(e.availableAt) > new Date() ? <span className="text-caption">{dateTime(e.availableAt)}</span> : ''}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export default function CourierWalletsPage() {
  const t = useT();
  const couriers = useLoad<Courier[]>('/finance/couriers');
  const payIns = useLoad<PayIn[]>('/finance/pay-ins?status=SUBMITTED');
  const withdrawals = useLoad<Withdrawal[]>('/finance/withdrawals');
  const r = useRunner(() => Promise.all([couriers.reload(), payIns.reload(), withdrawals.reload()]));
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  if (!couriers.data) return <Loading />;
  const list = couriers.data.filter((c) => (filter === 'FROZEN' ? c.frozen : filter === 'CASH' ? c.cashToHandIn > 0 : true));
  const openWithdrawals = (withdrawals.data ?? []).filter((w) => w.status === 'PENDING_APPROVAL' || w.status === 'APPROVED');

  return (
    <div className="space-y-5">
      <PageHeader title={t('Courier wallets')} subtitle={t('Points earned, deductions, Fawry pay ins and withdrawals')} />
      {r.view}
      <Card title={t('Fawry pay ins to check ({count})', { count: payIns.data?.length ?? 0 })}>
        {(payIns.data ?? []).length === 0 ? (
          <Empty>{t('Nothing to check')}</Empty>
        ) : (
          <Table head={[t('Pay in'), t('Courier'), t('Amount'), t('For'), t('Receipt'), '']}>
            {payIns.data!.map((p) => (
              <tr key={p.id}>
                <Td><span className="ltr-iso font-bold">{p.code}</span><div className="text-caption text-text-muted">{dateTime(p.createdAt)}</div></Td>
                <Td>{p.courierName}</Td>
                <Td><span className="font-bold">{egp(p.amount)}</span></Td>
                <Td>{p.purpose === 'RECHARGE' ? t('Wallet recharge') : t('Run cash')}<div className="ltr-iso text-caption text-text-muted">{p.channel} {p.reference}</div></Td>
                <Td><a className="font-bold text-link" href={`/api/finance/pay-ins/${p.id}/receipt`} target="_blank" rel="noreferrer">{t('Open')}</a></Td>
                <Td>
                  <div className="flex gap-1">
                    <Button onClick={() => void r.call(`/finance/pay-ins/${p.id}/approve`, {}, 'Confirmed')}>{t('Money arrived')}</Button>
                    <Button tone="ghost" onClick={() => { const note = window.prompt(t('Why is it rejected?')); if (note) void r.call(`/finance/pay-ins/${p.id}/reject`, { note }, 'Rejected'); }}>{t('Reject')}</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={t('Withdrawal requests ({count})', { count: openWithdrawals.length })}>
        {openWithdrawals.length === 0 ? (
          <Empty>{t('No open requests')}</Empty>
        ) : (
          <Table head={[t('Request'), t('Courier'), t('Amount'), t('Pay to'), t('Status'), '']}>
            {openWithdrawals.map((w) => (
              <tr key={w.id}>
                <Td><span className="ltr-iso font-bold">{w.code}</span></Td>
                <Td>{w.courierName}</Td>
                <Td><span className="font-bold">{egp(w.amount)}</span></Td>
                <Td><span className="ltr-iso">{w.method}</span></Td>
                <Td><RequestBadge status={w.status} /></Td>
                <Td>
                  <div className="flex gap-1">
                    {w.status === 'PENDING_APPROVAL' && <Button onClick={() => void r.call(`/finance/withdrawals/${w.id}/approve`, {}, 'Approved')}>{t('Approve')}</Button>}
                    {w.status === 'PENDING_APPROVAL' && <Button tone="ghost" onClick={() => void r.call(`/finance/withdrawals/${w.id}/reject`, {}, 'Rejected')}>{t('Reject')}</Button>}
                    {w.status === 'APPROVED' && <Button onClick={() => void r.call(`/finance/withdrawals/${w.id}/paid`, {}, 'Marked paid')}>{t('Mark paid')}</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card
        title={t('{count} couriers', { count: list.length })}
        actions={
          <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t('Everyone')}</option>
            <option value="FROZEN">{t('Frozen (negative wallet)')}</option>
            <option value="CASH">{t('Holding cash')}</option>
          </Select>
        }
      >
        <Table head={[t('Courier'), t('Agent'), t('Wallet'), t('Cash to hand in'), t('Status'), '']}>
          {list.map((c) => (
            <Fragment key={c.id}>
              <tr>
                <Td>{c.name}<div className="text-caption text-text-muted"><span className="ltr-iso">{c.hub}</span> {c.courierType ? t(c.courierType === 'PICKUP' ? 'Pickup' : 'Delivery') : ''}</div></Td>
                <Td>{c.agent}{c.paidByAgent && <div className="text-caption text-text-muted">{t('Paid by agent')}</div>}</Td>
                <Td><span className={c.wallet < 0 ? 'font-bold text-danger' : ''}>{egp(c.wallet)}</span></Td>
                <Td>{c.cashToHandIn ? egp(c.cashToHandIn) : ''}</Td>
                <Td>{c.frozen ? <Badge tone="red">{t('Frozen')}</Badge> : null}</Td>
                <Td><Button tone="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? t('Close') : t('Open')}</Button></Td>
              </tr>
              {open === c.id && (
                <tr>
                  <td colSpan={6} className="p-2"><CourierDetail id={c.id} onChange={() => void couriers.reload()} /></td>
                </tr>
              )}
            </Fragment>
          ))}
        </Table>
      </Card>
    </div>
  );
}

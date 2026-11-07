'use client';
import { RequestBadge, useRunner } from '@/components/money';
import { Button, Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Deposit { id: string; code: string; amount: number; reference: string; status: string; receiptMime: string; createdAt: string; hub: { code: string; name: string } | null }

export default function SafesPage() {
  const t = useT();
  const safes = useLoad<{ id: string; name: string; balance: number }[]>('/finance/wallets/HUB');
  const deposits = useLoad<Deposit[]>('/finance/deposits');
  const r = useRunner(() => Promise.all([safes.reload(), deposits.reload()]));
  if (!safes.data || !deposits.data) return <Loading />;
  const waiting = deposits.data.filter((d) => d.status === 'SUBMITTED');
  return (
    <div className="space-y-5">
      <PageHeader title={t('Hub safes')} subtitle={t('Cash handed in by couriers at each hub, and its trip to the bank')} />
      {r.view}
      <Card title={t('Deposits to confirm ({count})', { count: waiting.length })}>
        {waiting.length === 0 ? (
          <Empty>{t('Nothing to confirm')}</Empty>
        ) : (
          <Table head={[t('Deposit'), t('Hub'), t('Amount'), t('Reference'), t('Receipt'), '']}>
            {waiting.map((d) => (
              <tr key={d.id}>
                <Td><span className="ltr-iso font-bold">{d.code}</span><div className="text-caption text-text-muted">{dateTime(d.createdAt)}</div></Td>
                <Td>{d.hub?.name}</Td>
                <Td><span className="font-bold">{egp(d.amount)}</span></Td>
                <Td><span className="ltr-iso">{d.reference}</span></Td>
                <Td>{d.receiptMime ? <a className="font-bold text-link" href={`/api/finance/deposits/${d.id}/receipt`} target="_blank" rel="noreferrer">{t('Open')}</a> : ''}</Td>
                <Td>
                  <div className="flex gap-1">
                    <Button onClick={() => void r.call(`/finance/deposits/${d.id}/approve`, {}, 'Confirmed')}>{t('Money arrived')}</Button>
                    <Button tone="ghost" onClick={() => { const note = window.prompt(t('Why is it rejected?')); if (note) void r.call(`/finance/deposits/${d.id}/reject`, { note }, 'Rejected'); }}>{t('Reject')}</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('Cash in each safe')}>
          {safes.data.length === 0 ? (
            <Empty>{t('All safes are empty')}</Empty>
          ) : (
            <Table head={[t('Hub'), t('In the safe')]}>
              {safes.data.map((s) => (
                <tr key={s.id}><Td>{s.name}</Td><Td><span className="font-bold">{egp(s.balance)}</span></Td></tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title={t('Recent deposits')}>
          <Table head={[t('Deposit'), t('Hub'), t('Amount'), t('Status')]}>
            {deposits.data.slice(0, 30).map((d) => (
              <tr key={d.id}><Td><span className="ltr-iso">{d.code}</span></Td><Td>{d.hub?.code}</Td><Td>{egp(d.amount)}</Td><Td><RequestBadge status={d.status} /></Td></tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}

'use client';
import { RequestBadge, useRunner } from '@/parcels/components/money';
import { Button, Card, Empty, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Advance { id: string; code: string; agentName: string; amount: number; status: string; note: string; settlementId: string | null; createdAt: string }

export default function AdvancesPage() {
  const t = useT();
  const list = useLoad<Advance[]>('/finance/advances');
  const r = useRunner(() => list.reload());
  if (!list.data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('Agent advances')} subtitle={t('Money paid to agents before month end; it comes off their next settlement')} />
      {r.view}
      <Card>
        {list.data.length === 0 ? <Empty>{t('No advances yet')}</Empty> : (
          <Table head={[t('Advance'), t('Agent'), t('Amount'), t('Notes'), t('Status'), '']}>
            {list.data.map((a) => (
              <tr key={a.id}>
                <Td><span className="ltr-iso font-bold">{a.code}</span><div className="text-caption text-text-muted">{dateTime(a.createdAt)}</div></Td>
                <Td>{a.agentName}</Td>
                <Td><span className="font-bold">{egp(a.amount)}</span></Td>
                <Td>{a.note}</Td>
                <Td><RequestBadge status={a.status} />{a.settlementId && <div className="text-caption text-text-muted">{t('Taken off a settlement')}</div>}</Td>
                <Td>
                  <div className="flex gap-1">
                    {a.status === 'PENDING_APPROVAL' && <Button onClick={() => void r.call(`/finance/advances/${a.id}/approve`, {}, 'Approved')}>{t('Approve')}</Button>}
                    {a.status === 'PENDING_APPROVAL' && <Button tone="ghost" onClick={() => void r.call(`/finance/advances/${a.id}/reject`, {}, 'Rejected')}>{t('Reject')}</Button>}
                    {a.status === 'APPROVED' && <Button onClick={() => void r.call(`/finance/advances/${a.id}/paid`, {}, 'Marked paid')}>{t('Mark paid')}</Button>}
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

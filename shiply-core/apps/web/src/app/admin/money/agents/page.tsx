'use client';
import { useState } from 'react';
import { useMe } from '@/components/Shell';
import { RequestBadge, readFile, useRunner } from '@/components/money';
import { Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { SettlementBreakdown, type Preview } from '@/components/SettlementBreakdown';
import { useT } from '@/lib/i18n';

interface Settlement { id: string; code: string; month: string; total: number; status: string; hasInvoice: boolean; createdById: string; agent: { name: string; code: string } | null; commission: number; staffPay: number }

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export default function AgentSettlementsPage() {
  const t = useT();
  const me = useMe();
  const agents = useLoad<{ id: string; name: string }[]>('/admin/agents');
  const list = useLoad<Settlement[]>('/finance/settlements');
  const [agentId, setAgentId] = useState('');
  const [month, setMonth] = useState(lastMonth());
  const [preview, setPreview] = useState<Preview | null>(null);
  const r = useRunner(() => list.reload());
  if (!agents.data || !list.data) return <Loading />;

  const look = () => r.run(async () => setPreview(await api<Preview>(`/finance/settlements/preview?agentId=${agentId}&month=${month}`)), 'Worked out from the records');
  const upload = (id: string, file: File | undefined) => file && r.run(async () => api(`/finance/settlements/${id}/invoice`, { body: await readFile(file) }), 'Invoice uploaded');

  return (
    <div className="space-y-5">
      <PageHeader title={t('Agent settlements')} subtitle={t('Month end: staff pay, commission and vehicles, minus deductions. Paid after the agent’s invoice.')} />
      {r.view}
      <Card title={t('Work out a month')}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('Agent')}>
            <Select value={agentId} onChange={(e) => { setAgentId(e.target.value); setPreview(null); }}>
              <option value="">{t('Choose an agent')}</option>
              {agents.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label={t('Month')}>
            <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPreview(null); }} className="ltr-iso" />
          </Field>
          <Button tone="secondary" disabled={!agentId} onClick={() => void look()}>{t('Show')}</Button>
          {preview && <Button onClick={() => void r.call('/finance/settlements', { agentId, month }, 'Settlement created. Someone else must approve it').then((ok) => ok && setPreview(null))}>{t('Create settlement')}</Button>}
        </div>
        {preview && <div className="mt-4"><SettlementBreakdown p={preview} /></div>}
      </Card>
      <Card title={t('Settlements')}>
        {list.data.length === 0 ? (
          <Empty>{t('No settlements yet')}</Empty>
        ) : (
          <Table head={[t('Settlement'), t('Agent'), t('Month'), t('Total'), t('Invoice'), t('Status'), '']}>
            {list.data.map((x) => (
              <tr key={x.id}>
                <Td><span className="ltr-iso font-bold">{x.code}</span></Td>
                <Td>{x.agent?.name}</Td>
                <Td><span className="ltr-iso">{x.month}</span></Td>
                <Td><span className="font-bold">{egp(x.total)}</span></Td>
                <Td>
                  {x.hasInvoice ? <a className="font-bold text-link" href={`/api/finance/settlements/${x.id}/invoice`} target="_blank" rel="noreferrer">{t('Open')}</a> : <Badge tone="amber">{t('Missing')}</Badge>}
                  {(x.status === 'PENDING_APPROVAL' || x.status === 'APPROVED') && (
                    <label className="ms-2 cursor-pointer text-caption font-bold text-link">
                      {t('Upload')}
                      <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { void upload(x.id, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  )}
                </Td>
                <Td><RequestBadge status={x.status} /></Td>
                <Td>
                  <div className="flex gap-1">
                    {x.status === 'PENDING_APPROVAL' && x.createdById !== me.id && <Button onClick={() => void r.call(`/finance/settlements/${x.id}/approve`, {}, 'Approved and booked')}>{t('Approve')}</Button>}
                    {x.status === 'PENDING_APPROVAL' && x.createdById !== me.id && <Button tone="ghost" onClick={() => void r.call(`/finance/settlements/${x.id}/reject`, {}, 'Rejected')}>{t('Reject')}</Button>}
                    {x.status === 'PENDING_APPROVAL' && x.createdById === me.id && <span className="text-caption text-text-muted">{t('Someone else approves')}</span>}
                    {x.status === 'APPROVED' && x.total > 0 && <Button disabled={!x.hasInvoice} onClick={() => { const ref = window.prompt(t('Bank transfer reference')); if (ref !== null) void r.call(`/finance/settlements/${x.id}/paid`, { reference: ref }, 'Marked paid'); }}>{t('Mark paid')}</Button>}
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

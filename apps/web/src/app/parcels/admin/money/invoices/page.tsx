'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '@/parcels/components/Shell';
import { downloadFile, useRunner } from '@/parcels/components/money';
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Row { id: string; number: string; kind: string; month: string; total: number; vat: number; status: string; etaStatus: string; createdById: string; merchant: { name: string } | null }

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const ETA: Record<string, string> = { NOT_SENT: 'Not sent', EXPORTED: 'File downloaded', SUBMITTED: 'Accepted by ETA' };

export default function InvoicesPage() {
  const t = useT();
  const me = useMe();
  const [month, setMonth] = useState(lastMonth());
  const list = useLoad<Row[]>(`/finance/invoices?month=${month}`);
  const r = useRunner(() => list.reload());
  if (!list.data) return <Loading />;
  const credit = (inv: Row) => {
    const amount = window.prompt(t('Amount to credit back, in EGP, VAT included'));
    if (!amount) return;
    const reason = window.prompt(t('Reason'));
    if (!reason) return;
    void r.call('/finance/credit-notes', { invoiceId: inv.id, amount: Math.round(Number(amount) * 100), reason }, 'Credit note saved. Someone else must approve it');
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Tax invoices')}
        subtitle={t('One invoice per merchant per month, numbered once. Credit notes need a second person.')}
        actions={
          <div className="flex gap-2">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ltr-iso w-40" />
            <Button onClick={() => void r.run(async () => { const x = await api<{ made: string[] }>('/finance/invoices/issue', { body: { month } }); r.setMsg({ ok: true, text: t('{count} invoices issued', { count: x.made.length }) }); }, 'Done')}>{t('Issue invoices')}</Button>
          </div>
        }
      />
      {r.view}
      <Card>
        {list.data.length === 0 ? <Empty>{t('No invoices for this month')}</Empty> : (
          <Table head={[t('Number'), t('Merchant'), t('Kind'), t('VAT'), t('Total'), t('Status'), t('Tax authority'), '']}>
            {list.data.map((x) => (
              <tr key={x.id}>
                <Td><Link href={`/parcels/admin/money/invoices/${x.id}`} className="ltr-iso font-bold text-link">{x.number}</Link></Td>
                <Td>{x.merchant?.name}</Td>
                <Td>{x.kind === 'CREDIT_NOTE' ? t('Credit note') : t('Invoice')}</Td>
                <Td>{egp(x.vat)}</Td>
                <Td><span className="font-bold">{egp(x.total)}</span></Td>
                <Td>{x.status === 'ISSUED' ? <Badge tone="green">{t('Issued')}</Badge> : x.status === 'REJECTED' ? <Badge tone="red">{t('Rejected')}</Badge> : <Badge tone="amber">{t('Waiting for approval')}</Badge>}</Td>
                <Td><span className="text-caption">{t(ETA[x.etaStatus] ?? x.etaStatus)}</span></Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {x.status === 'ISSUED' && <Button tone="ghost" onClick={() => void r.run(() => downloadFile(`/finance/invoices/${x.id}/eta`, `ETA ${x.number}.json`), 'File downloaded')}>{t('ETA file')}</Button>}
                    {x.kind === 'INVOICE' && x.status === 'ISSUED' && <Button tone="ghost" onClick={() => credit(x)}>{t('Credit note')}</Button>}
                    {x.status === 'PENDING_APPROVAL' && x.createdById !== me.id && (
                      <>
                        <Button onClick={() => void r.call(`/finance/credit-notes/${x.id}/approve`, {}, 'Approved and booked')}>{t('Approve')}</Button>
                        <Button tone="ghost" onClick={() => void r.call(`/finance/credit-notes/${x.id}/reject`, {}, 'Rejected')}>{t('Reject')}</Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <p className="text-caption text-text-muted">{t('Sending to the tax authority needs the company ETA client id, secret and signing token. Until then download the file and upload it on the ETA portal.')}</p>
    </div>
  );
}

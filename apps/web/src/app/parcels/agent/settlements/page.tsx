'use client';
import { useState } from 'react';
import { MoneyInput, RequestBadge, readFile, toPiastres, useRunner } from '@/parcels/components/money';
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Settlement { id: string; code: string; month: string; staffPay: number; commission: number; vehicleRent: number; specialVehicles: number; penalties: number; total: number; advances: number; status: string; hasInvoice: boolean }

/** The agent sees what Shiply owes them each month and uploads their invoice so it can be paid. */
interface Advances {
  room: { month: string; earnedSoFar: number; cap: number; taken: number; available: number };
  list: { id: string; code: string; amount: number; status: string; note: string; settlementId: string | null }[];
}

function AdvancesCard() {
  const t = useT();
  const adv = useLoad<Advances>('/agent/advances');
  const r = useRunner(() => adv.reload());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  if (!adv.data) return null;
  const room = adv.data.room;
  return (
    <Card title={t('Advance before month end')}>
      <div className="space-y-3">
        {r.view}
        <p className="text-body-sm">
          {t('Earned this month so far')}: <span className="font-bold">{egp(room.earnedSoFar)}</span> · {t('You can take now')}: <span className="font-bold">{egp(room.available)}</span>
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(async () => {
              await api('/agent/advances', { body: { amount: toPiastres(amount), note } });
              setAmount('');
              setNote('');
            }, 'Request sent');
          }}
        >
          <MoneyInput required value={amount} onChange={setAmount} placeholder={t('Amount (EGP)')} />
          <Input placeholder={t('Notes')} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" disabled={room.available <= 0}>{t('Ask for an advance')}</Button>
        </form>
        {adv.data.list.length > 0 && (
          <ul className="divide-y divide-line text-body-sm">
            {adv.data.list.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span><span className="ltr-iso">{a.code}</span> · {egp(a.amount)}{a.settlementId && <span className="ms-2 text-caption text-text-muted">{t('Taken off a settlement')}</span>}</span>
                <RequestBadge status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default function AgentSettlements() {
  const t = useT();
  const list = useLoad<Settlement[]>('/agent/settlements');
  const r = useRunner(() => list.reload());
  if (!list.data) return <Loading />;
  const upload = (id: string, file: File | undefined) => file && r.run(async () => api(`/agent/settlements/${id}/invoice`, { body: await readFile(file) }), 'Invoice uploaded');
  return (
    <div className="space-y-5">
      <PageHeader title={t('Monthly settlements')} subtitle={t('Staff pay, commission and vehicles for each month. Upload your invoice to be paid.')} />
      {r.view}
      <AdvancesCard />
      <Card>
        {list.data.length === 0 ? <Empty>{t('No settlements yet')}</Empty> : (
          <Table head={[t('Month'), t('Staff pay'), t('Commission'), t('Vehicles'), t('Deductions'), t('Total'), t('Invoice'), t('Status')]}>
            {list.data.map((x) => (
              <tr key={x.id}>
                <Td><span className="ltr-iso font-bold">{x.month}</span><div className="ltr-iso text-caption text-text-muted">{x.code}</div></Td>
                <Td>{egp(x.staffPay)}</Td>
                <Td>{egp(x.commission)}</Td>
                <Td>{egp(x.vehicleRent + x.specialVehicles)}</Td>
                <Td>{x.penalties ? <span className="text-danger">{egp(-x.penalties)}</span> : ''}</Td>
                <Td><span className="font-bold">{egp(x.total)}</span>{x.advances > 0 && <div className="text-caption text-text-muted">{t('Less advances')} {egp(x.advances)}</div>}</Td>
                <Td>
                  {x.hasInvoice ? <Badge tone="green">{t('Uploaded')}</Badge> : <Badge tone="amber">{t('Missing')}</Badge>}
                  {(x.status === 'PENDING_APPROVAL' || x.status === 'APPROVED') && (
                    <label className="ms-2 cursor-pointer text-caption font-bold text-link">
                      {t('Upload')}
                      <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { void upload(x.id, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  )}
                </Td>
                <Td><RequestBadge status={x.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

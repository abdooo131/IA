'use client';
import { useState } from 'react';
import { PhotoButton, photoBody } from '@/parcels/components/PhotoButton';
import { TICKET_KIND, TicketStatus, type Ticket } from '@/parcels/components/Tickets';
import { MoneyInput, useRunner } from '@/parcels/components/money';
import { Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

/** Quality tickets: a waiting time for operations to cancel, then the penalty, then an appeal window. */
export default function QcPage() {
  const t = useT();
  const [status, setStatus] = useState('');
  const list = useLoad<Ticket[]>(`/control/tickets${status ? `?status=${status}` : ''}`);
  const couriers = useLoad<{ id: string; name: string; hub: string }[]>('/finance/couriers');
  const r = useRunner(() => list.reload());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'CUSTOMER_COMPLAINT', shipmentCode: '', courierId: '', penalty: '', description: '' });
  const [photo, setPhoto] = useState<string | null>(null);
  if (!list.data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Quality tickets')}
        subtitle={t('A ticket waits before its penalty applies, so operations can cancel it. After that the courier or agent can appeal.')}
        actions={
          <div className="flex gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('All')}</option>
              <option value="OPEN">{t('Waiting')}</option>
              <option value="APPEALED">{t('Appealed')}</option>
              <option value="CONFIRMED">{t('Penalty applied')}</option>
            </Select>
            <Button onClick={() => setOpen((o) => !o)}>{open ? t('Close') : t('New ticket')}</Button>
          </div>
        }
      />
      {r.view}
      {open && (
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(async () => {
                await api('/control/tickets', { body: { ...f, shipmentCode: f.shipmentCode || undefined, courierId: f.courierId || null, penalty: f.penalty ? Math.round(Number(f.penalty) * 100) : 0, photo: photo ? photoBody(photo) : null } });
                setOpen(false);
                setPhoto(null);
              }, 'Ticket opened');
            }}
          >
            <Field label={t('Kind')}>
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {Object.entries(TICKET_KIND).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </Select>
            </Field>
            <Field label={t('Parcel')} hint={t('Optional. With no courier chosen, the last person who scanned it is held responsible')}><Input className="ltr-iso" value={f.shipmentCode} onChange={(e) => setF({ ...f, shipmentCode: e.target.value })} /></Field>
            <Field label={t('Courier')}>
              <Select value={f.courierId} onChange={(e) => setF({ ...f, courierId: e.target.value })}>
                <option value="">{t('From the parcel')}</option>
                {(couriers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.hub}</option>)}
              </Select>
            </Field>
            <Field label={t('Penalty (EGP)')}><MoneyInput value={f.penalty} onChange={(v) => setF({ ...f, penalty: v })} /></Field>
            <Field label={t('What happened')} className="sm:col-span-2"><Input required minLength={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <PhotoButton value={photo} onChange={setPhoto} />
            <div className="sm:col-span-2 lg:col-span-3"><Button type="submit">{t('Open ticket')}</Button></div>
          </form>
        </Card>
      )}
      <Card>
        {list.data.length === 0 ? <Empty>{t('No tickets')}</Empty> : (
          <Table head={[t('Ticket'), t('Kind'), t('Who'), t('Penalty'), t('Status'), '']}>
            {list.data.map((x) => (
              <tr key={x.id}>
                <Td>
                  <span className="ltr-iso font-bold">{x.code}</span>
                  {x.trackingNumber && <div className="ltr-iso text-caption">{x.trackingNumber}</div>}
                  <div className="text-caption text-text-muted">{dateTime(x.createdAt)}</div>
                </Td>
                <Td>
                  {t(TICKET_KIND[x.kind] ?? x.kind)}
                  <div className="max-w-xs text-caption text-text-muted">{x.description}</div>
                  {x.hasPhoto && <a className="text-caption font-bold text-link" href={`/api/parcels/control/tickets/${x.id}/photo`} target="_blank" rel="noreferrer">{t('Photo')}</a>}
                </Td>
                <Td>{x.courierName || x.responsibleName}{x.hubCode && <div className="ltr-iso text-caption text-text-muted">{x.hubCode}</div>}</Td>
                <Td>{x.penalty ? egp(x.penalty) : ''}</Td>
                <Td>
                  <TicketStatus status={x.status} />
                  {x.status === 'OPEN' && <div className="text-caption text-text-muted">{t('Applies {time}', { time: dateTime(x.confirmAt) })}</div>}
                  {x.overrideReason && <div className="text-caption">{x.overrideReason}</div>}
                  {x.appealText && <div className="max-w-xs text-caption">{t('Appeal')}: {x.appealText}</div>}
                  {x.decisionNote && <div className="text-caption text-text-muted">{x.decisionNote}</div>}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {x.status === 'OPEN' && (
                      <>
                        <Button tone="ghost" onClick={() => { const reason = window.prompt(t('Why cancel this ticket?')); if (reason) void r.call(`/control/tickets/${x.id}/override`, { reason }, 'Ticket cancelled'); }}>{t('Cancel')}</Button>
                        {x.courierName && <Button tone="ghost" onClick={() => { const v = window.prompt(t('New penalty in EGP')); if (v !== null) void r.run(() => api(`/control/tickets/${x.id}/penalty`, { method: 'PUT', body: { penalty: Math.round(Number(v) * 100) } }), 'Saved'); }}>{t('Change penalty')}</Button>}
                      </>
                    )}
                    {x.status === 'APPEALED' && (
                      <>
                        <Button onClick={() => { const note = window.prompt(t('Note for the decision')); if (note) void r.call(`/control/tickets/${x.id}/decide`, { decision: 'REVERSE', note }, 'Penalty reversed'); }}>{t('Accept appeal')}</Button>
                        <Button tone="ghost" onClick={() => { const note = window.prompt(t('Note for the decision')); if (note) void r.call(`/control/tickets/${x.id}/decide`, { decision: 'UPHOLD', note }, 'Appeal refused'); }}>{t('Refuse appeal')}</Button>
                      </>
                    )}
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

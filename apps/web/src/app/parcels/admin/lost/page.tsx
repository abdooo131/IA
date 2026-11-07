'use client';
import Link from 'next/link';
import { TICKET_KIND } from '@/parcels/components/Tickets';
import { Badge, Card, Empty, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Row { id: string; trackingNumber: string; status: string; customerName: string; codAmount: number; searchUntil: string | null; lostFinalAt: string | null; compensation: number; damaged: boolean; merchant: { name: string }; ticket: { code: string; status: string; kind: string; responsible: string } | null }

/** Lost parcels still being searched for or paid for, and damaged ones still in the network. */
export default function LostPage() {
  const t = useT();
  const list = useLoad<Row[]>('/control/lost');
  if (!list.data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('Lost and damaged')} subtitle={t('A missing parcel is searched for before the loss is final; scanning it anywhere ends the search')} />
      <Card>
        {list.data.length === 0 ? <Empty>{t('Nothing lost or damaged')}</Empty> : (
          <Table head={[t('Parcel'), t('Merchant'), t('State'), t('Held responsible'), 'COD']}>
            {list.data.map((x) => (
              <tr key={x.id}>
                <Td><Link href={`/parcels/admin/shipments/${x.id}`} className="ltr-iso font-bold text-link">{x.trackingNumber}</Link><div className="text-caption text-text-muted">{x.customerName}</div></Td>
                <Td>{x.merchant.name}</Td>
                <Td>
                  {x.status === 'LOST' && !x.lostFinalAt && <Badge tone="amber">{t('In search until {time}', { time: dateTime(x.searchUntil) })}</Badge>}
                  {x.lostFinalAt && <Badge tone="red">{t('Lost, merchant paid {amount}', { amount: egp(x.compensation) })}</Badge>}
                  {x.damaged && x.status !== 'LOST' && <Badge tone="red">{t('Damaged')}</Badge>}
                </Td>
                <Td>{x.ticket ? <span>{x.ticket.responsible || t('Nobody on record')}<div className="text-caption text-text-muted"><span className="ltr-iso">{x.ticket.code}</span> · {t(TICKET_KIND[x.ticket.kind] ?? x.ticket.kind)}</div></span> : ''}</Td>
                <Td>{egp(x.codAmount)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

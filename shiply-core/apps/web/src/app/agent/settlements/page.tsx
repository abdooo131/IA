'use client';
import { RequestBadge, readFile, useRunner } from '@/components/money';
import { Badge, Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Settlement { id: string; code: string; month: string; staffPay: number; commission: number; vehicleRent: number; specialVehicles: number; penalties: number; total: number; status: string; hasInvoice: boolean }

/** The agent sees what Shiply owes them each month and uploads their invoice so it can be paid. */
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
                <Td><span className="font-bold">{egp(x.total)}</span></Td>
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

'use client';
import Link from 'next/link';
import { Alert, Card, Empty, Loading, PageHeader, Stat, StatusBadge, Table, Td } from '@/components/ui';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

interface Statement {
  shipments: { id: string; trackingNumber: string; status: string; closedAt: string | null; codCollected: number; fees: number }[];
  codTotal: number;
  feesTotal: number;
  balance: number;
  cashStillWithCouriers: number;
  payouts: { id: string; code: string; codTotal: number; feesTotal: number; amount: number; reference: string; createdAt: string }[];
}

export default function StatementPage() {
  const { data, error, loading } = useLoad<Statement>('/merchant/statement');
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert>{error ?? 'Could not load your statement'}</Alert>;

  return (
    <div className="space-y-5">
      <PageHeader title="Money" subtitle="Cash we collected for you, minus our fees" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Next payout" value={egp(data.balance)} hint={data.balance < 0 ? 'You owe this to Shiply' : 'Ready to be paid to you'} />
        <Stat label="Cash collected" value={egp(data.codTotal)} />
        <Stat label="Our fees" value={egp(data.feesTotal)} />
        <Stat label="Still with couriers" value={egp(data.cashStillWithCouriers)} hint="Joins the next payout once handed in" />
      </div>

      <Card title={`Parcels in the next payout (${data.shipments.length})`}>
        {data.shipments.length === 0 ? (
          <Empty>Nothing waiting to be settled.</Empty>
        ) : (
          <Table head={['Tracking', 'Status', 'Closed', 'Collected', 'Fees', 'Net']}>
            {data.shipments.map((s) => (
              <tr key={s.id}>
                <Td><Link href={`/merchant/${s.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{s.trackingNumber}</Link></Td>
                <Td><StatusBadge status={s.status} /></Td>
                <Td>{dateTime(s.closedAt)}</Td>
                <Td className="tabular-nums">{egp(s.codCollected)}</Td>
                <Td className="tabular-nums">{egp(s.fees)}</Td>
                <Td className="tabular-nums font-semibold">{egp(s.codCollected - s.fees)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Past payouts">
        {data.payouts.length === 0 ? (
          <Empty>No payouts yet.</Empty>
        ) : (
          <Table head={['Payout', 'Date', 'Collected', 'Fees', 'Paid', 'Reference']}>
            {data.payouts.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono font-semibold">{p.code}</Td>
                <Td>{dateTime(p.createdAt)}</Td>
                <Td className="tabular-nums">{egp(p.codTotal)}</Td>
                <Td className="tabular-nums">{egp(p.feesTotal)}</Td>
                <Td className="tabular-nums font-semibold">{egp(p.amount)}</Td>
                <Td className="text-slate-600">{p.reference}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

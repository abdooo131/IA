'use client';
import Link from 'next/link';
import { StatCard } from '@/components/StatCard';
import { Alert, Card, Empty, Loading, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Statement {
  shipments: { id: string; trackingNumber: string; status: string; closedAt: string | null; codCollected: number; fees: number }[];
  codTotal: number;
  feesTotal: number;
  balance: number;
  cashStillWithCouriers: number;
  payouts: { id: string; code: string; codTotal: number; feesTotal: number; amount: number; reference: string; createdAt: string }[];
}

export default function StatementPage() {
  const t = useT();
  const { data, error, loading } = useLoad<Statement>('/merchant/statement');
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert>{error ?? t('Could not load your statement')}</Alert>;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('Merchant')} title={t('Money')} subtitle={t('Cash we collected for you, minus our fees')} />

      <section className="shiply-route overflow-hidden rounded-xl p-6 text-white shadow-md sm:p-8">
        <p className="text-label uppercase text-accent">{t('Next payout')}</p>
        <p className="tabular ltr-iso mt-2 text-h1 sm:text-display">{egp(data.balance)}</p>
        <p className="mt-2 text-body-sm opacity-90">{data.balance < 0 ? t('You owe this to Shiply') : t('Ready to be paid to you')}</p>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t('Cash collected')} value={egp(data.codTotal)} icon="cash" tone="delivered" />
        <StatCard label={t('Our fees')} value={egp(data.feesTotal)} icon="invoice" tone="primary" />
        <StatCard label={t('Still with couriers')} value={egp(data.cashStillWithCouriers)} hint={t('Joins the next payout once handed in')} icon="courier" tone="in-progress" />
      </div>

      <Card title={t('Parcels in the next payout ({n})', { n: data.shipments.length })}>
        {data.shipments.length === 0 ? (
          <Empty>{t('Nothing waiting to be settled.')}</Empty>
        ) : (
          <Table head={[t('Tracking'), t('Status'), t('Closed'), t('Collected'), t('Fees'), t('Net')]}>
            {data.shipments.map((s) => (
              <tr key={s.id}>
                <Td><Link href={`/merchant/${s.id}`} className="ltr-iso font-mono font-bold text-link hover:underline">{s.trackingNumber}</Link></Td>
                <Td><StatusBadge status={s.status} /></Td>
                <Td className="ltr-iso">{dateTime(s.closedAt)}</Td>
                <Td className="tabular ltr-iso">{egp(s.codCollected)}</Td>
                <Td className="tabular ltr-iso">{egp(s.fees)}</Td>
                <Td className="tabular ltr-iso font-bold">{egp(s.codCollected - s.fees)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={t('Past payouts')}>
        {data.payouts.length === 0 ? (
          <Empty>{t('No payouts yet.')}</Empty>
        ) : (
          <Table head={[t('Payout'), t('Date'), t('Collected'), t('Fees'), t('Paid'), t('Reference')]}>
            {data.payouts.map((p) => (
              <tr key={p.id}>
                <Td className="ltr-iso font-mono font-bold">{p.code}</Td>
                <Td className="ltr-iso">{dateTime(p.createdAt)}</Td>
                <Td className="tabular ltr-iso">{egp(p.codTotal)}</Td>
                <Td className="tabular ltr-iso">{egp(p.feesTotal)}</Td>
                <Td className="tabular ltr-iso font-bold">{egp(p.amount)}</Td>
                <Td className="text-text-muted">{p.reference}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { ColumnChart } from '@/parcels/components/charts/ColumnChart';
import { StatCard } from '@/parcels/components/StatCard';
import { WalletCard } from '@/parcels/components/WalletCard';
import { Card, Loading, PageHeader, Select, Table, Td } from '@/parcels/components/ui';
import { egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';
import { FAIL_REASON_LABELS_AR, FAIL_REASONS, type FailReason } from '@shiplynow/shared/parcels';

interface A {
  days: number;
  created: number;
  delivered: number;
  returned: number;
  inProgress: number;
  deliveryRate: number;
  firstAttemptRate: number;
  codCollected: number;
  fees: number;
  vatInFees: number;
  averageCost: number;
  failReasons: { reason: string; count: number }[];
  series: { date: string; created: number; delivered: number }[];
}

/** How the merchant's deliveries are going, and what each order really costs them. */
export default function MerchantAnalytics() {
  const t = useT();
  const locale = useLocale();
  const [days, setDays] = useState('30');
  const a = useLoad<A>(`/merchant/analytics?days=${days}`);
  if (!a.data) return <Loading />;
  const d = a.data;
  const reason = (r: string) =>
    (locale === 'ar'
      ? FAIL_REASON_LABELS_AR[r as FailReason]
      : FAIL_REASONS[r as FailReason]?.label) ?? r;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Analytics')}
        subtitle={t('Your deliveries and what each order costs')}
        actions={
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">{t('Last 7 days')}</option>
            <option value="30">{t('Last 30 days')}</option>
            <option value="90">{t('Last 90 days')}</option>
          </Select>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <WalletCard icon="cash" label={t('Cash collected for you')} value={egp(d.codCollected)} />
        <WalletCard
          icon="invoice"
          label={t('Average cost per order')}
          value={egp(d.averageCost)}
          hint={t('VAT included')}
        />
        <WalletCard
          icon="delivered"
          label={t('Delivery rate')}
          value={`${d.deliveryRate}%`}
          hint={t('{n}% on the first attempt', { n: d.firstAttemptRate })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Created')} value={String(d.created)} icon="create" />
        <StatCard
          label={t('Delivered')}
          value={String(d.delivered)}
          icon="delivered"
          tone="delivered"
        />
        <StatCard
          label={t('Returned')}
          value={String(d.returned)}
          icon="returns"
          tone="returning"
        />
        <StatCard
          label={t('In progress')}
          value={String(d.inProgress)}
          icon="route"
          tone="in-progress"
        />
      </div>
      <Card title={t('Delivered per day')}>
        <ColumnChart
          title={t('Delivered per day')}
          valueLabel={t('parcels')}
          columns={d.series.map((x) => ({
            key: x.date,
            label: `${x.date.slice(8)}/${x.date.slice(5, 7)}`,
            value: x.delivered,
            detail: `${x.date}: ${x.delivered}`,
          }))}
        />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('Why deliveries failed')}>
          <Table head={[t('Reason'), t('Parcels')]}>
            {d.failReasons.map((r) => (
              <tr key={r.reason}>
                <Td>{reason(r.reason)}</Td>
                <Td>{r.count}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={t('What you paid us')}>
          <div className="space-y-2 text-body-sm">
            <div className="flex justify-between">
              <span>{t('Fees on closed parcels')}</span>
              <span className="font-bold">{egp(d.fees)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('of which VAT')}</span>
              <span>{egp(d.vatInFees)}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

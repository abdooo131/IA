'use client';
import { useState } from 'react';
import { Card, Empty, Input, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { egp, todayCairo } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Row {
  id: string;
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  parcels: number;
}

function ProfitTable({
  title,
  rows,
  costLabel,
}: {
  title: string;
  rows: Row[];
  costLabel: string;
}) {
  const t = useT();
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <Empty>{t('Nothing in this period')}</Empty>
      ) : (
        <Table head={[t('Name'), t('Parcels'), t('Revenue before VAT'), costLabel, t('Profit')]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{r.parcels}</Td>
              <Td>{egp(r.revenue)}</Td>
              <Td>{egp(r.cost)}</Td>
              <Td>
                <span className={`font-bold ${r.profit < 0 ? 'text-danger' : ''}`}>
                  {egp(r.profit)}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

export default function ProfitPage() {
  const t = useT();
  const [from, setFrom] = useState(`${todayCairo().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayCairo());
  const p = useLoad<{ merchants: Row[]; hubs: Row[]; couriers: Row[] }>(
    `/finance/reports/profit?from=${from}&to=${to}`,
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Profit per merchant, hub and courier')}
        subtitle={t(
          'Fees before VAT against courier pay; hubs also carry their own expenses and bills',
        )}
        actions={
          <div className="flex gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ltr-iso w-40"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ltr-iso w-40"
            />
          </div>
        }
      />
      {!p.data ? (
        <Loading />
      ) : (
        <>
          <ProfitTable
            title={t('Merchants')}
            rows={p.data.merchants}
            costLabel={t('Courier pay')}
          />
          <ProfitTable
            title={t('Hubs')}
            rows={p.data.hubs}
            costLabel={t('Courier pay and hub costs')}
          />
          <ProfitTable title={t('Couriers')} rows={p.data.couriers} costLabel={t('Courier pay')} />
        </>
      )}
    </div>
  );
}

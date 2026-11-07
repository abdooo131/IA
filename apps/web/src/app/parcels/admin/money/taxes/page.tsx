'use client';
import { useState } from 'react';
import { StatCard } from '@/parcels/components/StatCard';
import { useRunner } from '@/parcels/components/money';
import { Alert, Button, Card, Input, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Vat { month: string; outputVat: number; inputVat: number; netVat: number; withholding: number; vatPaid: boolean; whtPaid: boolean; invoices: { kind: string; count: number; net: number; vat: number }[] }

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/** VAT and withholding tax for a month, and paying them. */
export default function TaxesPage() {
  const t = useT();
  const [month, setMonth] = useState(lastMonth());
  const v = useLoad<Vat>(`/finance/reports/vat?month=${month}`);
  const r = useRunner(() => v.reload());
  if (!v.data) return <Loading />;
  const d = v.data;
  const pay = (path: string) => {
    const reference = window.prompt(t('Payment reference'));
    if (reference !== null) void r.call(path, { month, reference }, 'Paid and booked');
  };
  return (
    <div className="space-y-5">
      <PageHeader title={t('Taxes')} subtitle={t('VAT on our fees against VAT on purchases, and withholding tax held from suppliers')} actions={<Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ltr-iso w-40" />} />
      {r.view}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('VAT on sales')} value={egp(d.outputVat)} icon="invoice" />
        <StatCard label={t('VAT paid on purchases')} value={egp(d.inputVat)} icon="products" />
        <StatCard label={t('VAT to pay')} value={egp(d.netVat)} icon="wallet" tone="needs-action" alert={d.netVat > 0 && !d.vatPaid} />
        <StatCard label={t('Withholding tax to pay')} value={egp(d.withholding)} icon="cash" />
      </div>
      <Card>
        <div className="flex flex-wrap gap-2">
          {d.vatPaid ? <Alert tone="success">{t('VAT for this month is paid')}</Alert> : <Button onClick={() => pay('/finance/tax/vat-payment')}>{t('Record VAT payment')}</Button>}
          {d.whtPaid ? <Alert tone="success">{t('Withholding tax for this month is paid')}</Alert> : d.withholding > 0 && <Button tone="secondary" onClick={() => pay('/finance/tax/wht-payment')}>{t('Record withholding payment')}</Button>}
        </div>
      </Card>
      <Card title={t('Documents issued this month')}>
        <Table head={[t('Kind'), t('Count'), t('Before VAT'), t('VAT')]}>
          {d.invoices.map((i) => (
            <tr key={i.kind}><Td>{i.kind === 'CREDIT_NOTE' ? t('Credit notes') : t('Invoices')}</Td><Td>{i.count}</Td><Td>{egp(i.net)}</Td><Td>{egp(i.vat)}</Td></tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

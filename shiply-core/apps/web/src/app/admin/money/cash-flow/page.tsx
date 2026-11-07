'use client';
import { useState } from 'react';
import { Card, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { egp, todayCairo } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

const SOURCE: Record<string, string> = {
  RUN_CLOSED: 'Cash handed in by couriers', PAY_IN: 'Fawry pay ins', PAYOUT: 'Merchant payouts', WITHDRAWAL: 'Courier withdrawals', AGENT_PAYMENT: 'Agent settlements',
  AGENT_ADVANCE: 'Agent advances', EXPENSE: 'Expenses', BILL_PAYMENT: 'Supplier bills', VAT_PAYMENT: 'VAT paid', WHT_PAYMENT: 'Withholding tax paid',
  BANK_LINE: 'Bank charges and interest', EARNING_ADJUSTMENT: 'Courier recharges', SAFE_DEPOSIT: 'Safe to bank', MANUAL: 'Opening balances and owner',
};

export default function CashFlowPage() {
  const t = useT();
  const [from, setFrom] = useState(`${todayCairo().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayCairo());
  const c = useLoad<{ opening: number; closing: number; change: number; rows: { source: string; group: string; amount: number }[] }>(`/finance/reports/cash-flow?from=${from}&to=${to}`);
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Cash flow')}
        subtitle={t('Money in and out of the bank and the hub safes, by what moved it')}
        actions={
          <div className="flex gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ltr-iso w-40" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ltr-iso w-40" />
          </div>
        }
      />
      {!c.data ? <Loading /> : (
        <Card>
          <Table head={[t('What'), t('Group'), t('Amount')]}>
            <tr className="font-bold"><Td>{t('Cash at the start')}</Td><Td /><Td>{egp(c.data.opening)}</Td></tr>
            {c.data.rows.map((r) => (
              <tr key={r.source}><Td>{t(SOURCE[r.source] ?? r.source)}</Td><Td><span className="text-caption text-text-muted">{t(r.group)}</span></Td><Td><span className={r.amount < 0 ? 'text-danger' : ''}>{egp(r.amount)}</span></Td></tr>
            ))}
            <tr className="font-bold"><Td>{t('Cash at the end')}</Td><Td /><Td>{egp(c.data.closing)}</Td></tr>
          </Table>
        </Card>
      )}
    </div>
  );
}

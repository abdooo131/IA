'use client';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader, Stat, Table, Td, cx } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

interface Balance {
  merchantId: string;
  code: string;
  name: string;
  parcels: number;
  codTotal: number;
  feesTotal: number;
  balance: number;
}
interface Payout {
  id: string;
  code: string;
  merchant: { name: string };
  codTotal: number;
  feesTotal: number;
  amount: number;
  reference: string;
  createdAt: string;
  _count: { shipments: number };
}
interface CourierCash {
  id: string;
  code: string;
  date: string;
  courier: string;
  hub: string;
  expected: number;
  received: number;
  difference: number;
}

export default function MoneyPage() {
  const balances = useLoad<Balance[]>('/admin/balances');
  const payouts = useLoad<Payout[]>('/admin/payouts');
  const cash = useLoad<CourierCash[]>('/admin/courier-cash');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const payOut = async (b: Balance) => {
    const reference = window.prompt(
      `Pay out ${egp(b.balance)} to ${b.name} for ${b.parcels} parcels?\nMake the bank transfer first, then write its reference here.`,
    );
    if (reference === null) return;
    setBusy(b.merchantId);
    setMsg(null);
    try {
      const p = await api<{ code: string; amount: number }>(`/admin/merchants/${b.merchantId}/payouts`, { body: { reference } });
      setMsg({ ok: true, text: `Payout ${p.code} recorded: ${egp(p.amount)} to ${b.name}` });
      await Promise.all([balances.reload(), payouts.reload()]);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const owed = balances.data?.reduce((n, b) => n + Math.max(0, b.balance), 0) ?? 0;
  const shortages = cash.data?.filter((c) => c.difference !== 0) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Money" subtitle="Merchant balances, payouts and courier cash" />
      {msg && <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Owed to merchants" value={egp(owed)} hint="Ready to pay out" />
        <Stat label="Payouts made" value={payouts.data?.length ?? 0} />
        <Stat label="Runs with a cash difference" value={shortages.length} />
      </div>

      <Card title="Merchant balances">
        <p className="mb-3 text-sm text-slate-600">Only parcels whose courier cash is already in a hub safe are counted. Fees are taken from the cash we collected.</p>
        {balances.error && <Alert>{balances.error}</Alert>}
        {!balances.data ? (
          <Loading />
        ) : (
          <Table head={['Merchant', 'Parcels', 'COD collected', 'Fees', 'Balance', '']}>
            {balances.data.map((b) => (
              <tr key={b.merchantId}>
                <Td>
                  <span className="font-semibold">{b.name}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{b.code}</span>
                </Td>
                <Td className="tabular-nums">{b.parcels}</Td>
                <Td className="tabular-nums">{egp(b.codTotal)}</Td>
                <Td className="tabular-nums">{egp(b.feesTotal)}</Td>
                <Td className={cx('font-semibold tabular-nums', b.balance < 0 && 'text-rose-700')}>{egp(b.balance)}</Td>
                <Td>
                  <Button tone="secondary" disabled={b.parcels === 0 || busy === b.merchantId} onClick={() => payOut(b)}>
                    {b.balance < 0 ? 'Settle (merchant owes)' : 'Pay out'}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Payout history">
        {!payouts.data ? (
          <Loading />
        ) : payouts.data.length === 0 ? (
          <Empty>No payouts yet.</Empty>
        ) : (
          <Table head={['Payout', 'Merchant', 'Parcels', 'COD', 'Fees', 'Amount', 'Reference', 'Date']}>
            {payouts.data.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono font-semibold">{p.code}</Td>
                <Td>{p.merchant.name}</Td>
                <Td className="tabular-nums">{p._count.shipments}</Td>
                <Td className="tabular-nums">{egp(p.codTotal)}</Td>
                <Td className="tabular-nums">{egp(p.feesTotal)}</Td>
                <Td className="font-semibold tabular-nums">{egp(p.amount)}</Td>
                <Td>{p.reference}</Td>
                <Td className="text-slate-500">{dateTime(p.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Courier cash handovers">
        {!cash.data ? (
          <Loading />
        ) : cash.data.length === 0 ? (
          <Empty>No closed runs yet.</Empty>
        ) : (
          <Table head={['Run', 'Date', 'Courier', 'Hub', 'Expected', 'Received', 'Difference']}>
            {cash.data.map((c) => (
              <tr key={c.id} className={c.difference !== 0 ? 'bg-rose-50' : undefined}>
                <Td className="font-mono">{c.code}</Td>
                <Td>{shortDate(c.date)}</Td>
                <Td>{c.courier}</Td>
                <Td className="font-mono">{c.hub}</Td>
                <Td className="tabular-nums">{egp(c.expected)}</Td>
                <Td className="tabular-nums">{egp(c.received)}</Td>
                <Td className={cx('font-semibold tabular-nums', c.difference < 0 ? 'text-rose-700' : c.difference > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                  {c.difference === 0 ? 'OK' : egp(c.difference)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

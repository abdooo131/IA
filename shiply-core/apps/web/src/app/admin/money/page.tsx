'use client';
import { useState } from 'react';
import { StatCard } from '@/components/StatCard';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Table, Td, cx } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

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
  const t = useT();
  const balances = useLoad<Balance[]>('/admin/balances');
  const payouts = useLoad<Payout[]>('/admin/payouts');
  const cash = useLoad<CourierCash[]>('/admin/courier-cash');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const payOut = async (b: Balance) => {
    const reference = window.prompt(
      t('Pay out {amount} to {name} for {count} parcels? Make the bank transfer first, then write its reference here.', { amount: egp(b.balance), name: b.name, count: b.parcels }),
    );
    if (reference === null) return;
    setBusy(b.merchantId);
    setMsg(null);
    try {
      const p = await api<{ code: string; amount: number }>(`/admin/merchants/${b.merchantId}/payouts`, { body: { reference } });
      setMsg({ ok: true, text: t('Payout {code} recorded: {amount} to {name}', { code: p.code, amount: egp(p.amount), name: b.name }) });
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
      <PageHeader eyebrow={t('Admin')} title={t('Money')} subtitle={t('Merchant balances, payouts and courier cash')} />
      {msg && <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard icon="payout" tone="primary" label={t('Owed to merchants')} value={egp(owed)} hint={t('Ready to pay out')} />
        <StatCard icon="invoice" tone="delivered" label={t('Payouts made')} value={String(payouts.data?.length ?? 0)} />
        <StatCard icon="cash" tone="needs-action" label={t('Runs with a cash difference')} value={String(shortages.length)} alert={shortages.length > 0} />
      </div>

      <Card title={t('Merchant balances')}>
        <p className="mb-3 text-body-sm text-text-muted">{t('Only parcels whose courier cash is already in a hub safe are counted. Fees are taken from the cash we collected.')}</p>
        {balances.error && <Alert>{balances.error}</Alert>}
        {!balances.data ? (
          <Loading />
        ) : (
          <Table head={[t('Merchant'), t('Parcels'), t('COD collected'), t('Fees'), t('Balance'), '']}>
            {balances.data.map((b) => (
              <tr key={b.merchantId}>
                <Td>
                  <span className="font-bold">{b.name}</span>
                  <span className="ltr-iso ms-2 text-caption text-text-muted">{b.code}</span>
                </Td>
                <Td className="tabular">{b.parcels}</Td>
                <Td className="tabular ltr-iso">{egp(b.codTotal)}</Td>
                <Td className="tabular ltr-iso">{egp(b.feesTotal)}</Td>
                <Td className={cx('tabular ltr-iso font-bold', b.balance < 0 && 'text-danger')}>{egp(b.balance)}</Td>
                <Td>
                  <Button tone={b.parcels > 0 && b.balance > 0 ? 'accent' : 'secondary'} disabled={b.parcels === 0 || busy === b.merchantId} onClick={() => payOut(b)}>
                    {b.balance < 0 ? t('Settle (merchant owes)') : t('Pay out')}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={t('Payout history')}>
        {!payouts.data ? (
          <Loading />
        ) : payouts.data.length === 0 ? (
          <Empty>{t('No payouts yet.')}</Empty>
        ) : (
          <Table head={[t('Payout'), t('Merchant'), t('Parcels'), t('COD'), t('Fees'), t('Amount'), t('Reference'), t('Date')]}>
            {payouts.data.map((p) => (
              <tr key={p.id}>
                <Td className="ltr-iso font-bold">{p.code}</Td>
                <Td>{p.merchant.name}</Td>
                <Td className="tabular">{p._count.shipments}</Td>
                <Td className="tabular ltr-iso">{egp(p.codTotal)}</Td>
                <Td className="tabular ltr-iso">{egp(p.feesTotal)}</Td>
                <Td className="tabular ltr-iso font-bold">{egp(p.amount)}</Td>
                <Td>{p.reference}</Td>
                <Td className="text-text-muted">{dateTime(p.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={t('Courier cash handovers')}>
        {!cash.data ? (
          <Loading />
        ) : cash.data.length === 0 ? (
          <Empty>{t('No closed runs yet.')}</Empty>
        ) : (
          <Table head={[t('Run'), t('Date'), t('Courier'), t('Hub'), t('Expected'), t('Received'), t('Difference')]}>
            {cash.data.map((c) => (
              <tr key={c.id}>
                <Td className="ltr-iso font-bold">{c.code}</Td>
                <Td>{shortDate(c.date)}</Td>
                <Td>{c.courier}</Td>
                <Td className="ltr-iso">{c.hub}</Td>
                <Td className="tabular ltr-iso">{egp(c.expected)}</Td>
                <Td className="tabular ltr-iso">{egp(c.received)}</Td>
                <Td>
                  {c.difference === 0 ? <Badge tone="green">{t('OK')}</Badge> : <Badge tone={c.difference < 0 ? 'red' : 'amber'}><span className="ltr-iso">{egp(c.difference)}</span></Badge>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

'use client';
import Link from 'next/link';
import { StatCard } from '@/parcels/components/StatCard';
import { WalletCard } from '@/parcels/components/WalletCard';
import { useState } from 'react';
import { RequestBadge, useRunner } from '@/parcels/components/money';
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  StatusBadge,
  Table,
  Td,
} from '@/parcels/components/ui';
import { DAY_NAMES } from '@/parcels/components/workforce';
import { api } from '@/parcels/lib/api';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Statement {
  shipments: {
    id: string;
    trackingNumber: string;
    status: string;
    closedAt: string | null;
    codCollected: number;
    fees: number;
  }[];
  codTotal: number;
  feesTotal: number;
  balance: number;
  cashStillWithCouriers: number;
  payouts: {
    id: string;
    code: string;
    codTotal: number;
    feesTotal: number;
    amount: number;
    reference: string;
    status: string;
    createdAt: string;
  }[];
  bank: {
    bankName: string;
    accountName: string;
    iban: string;
    changePending: boolean;
    payoutDays: number[];
  };
}

function BankCard({ bank, onSaved }: { bank: Statement['bank']; onSaved: () => unknown }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ bankName: '', bankAccountName: '', iban: '' });
  const r = useRunner(onSaved);
  return (
    <Card
      title={t('Where we pay you')}
      actions={
        !editing && (
          <Button tone="secondary" onClick={() => setEditing(true)}>
            {bank.iban ? t('Change') : t('Add bank account')}
          </Button>
        )
      }
    >
      <div className="space-y-3 text-body-sm">
        {r.view}
        {bank.iban ? (
          <p>
            <span className="font-bold">{bank.bankName}</span> · {bank.accountName} ·{' '}
            <span className="ltr-iso">{bank.iban}</span>
          </p>
        ) : (
          <Alert tone="warning">{t('Add your bank account so we can pay you')}</Alert>
        )}
        {bank.changePending && (
          <Alert tone="info">
            {t('Your new bank account is waiting for our finance team to approve it')}
          </Alert>
        )}
        <p className="text-caption text-text-muted">
          {t('Payout days')}: {bank.payoutDays.map((d) => t(DAY_NAMES[d]!)).join(' ')}
        </p>
        {editing && (
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void r
                .run(
                  () => api('/merchant/bank', { method: 'PUT', body: f }),
                  bank.iban ? 'Sent. Our finance team approves bank changes' : 'Saved',
                )
                .then((ok) => ok && setEditing(false));
            }}
          >
            <Field label={t('Bank')}>
              <Input
                required
                value={f.bankName}
                onChange={(e) => setF({ ...f, bankName: e.target.value })}
              />
            </Field>
            <Field label={t('Account name')}>
              <Input
                required
                value={f.bankAccountName}
                onChange={(e) => setF({ ...f, bankAccountName: e.target.value })}
              />
            </Field>
            <Field label="IBAN" hint={t('EG followed by 27 digits')}>
              <Input
                required
                className="ltr-iso"
                value={f.iban}
                onChange={(e) => setF({ ...f, iban: e.target.value })}
              />
            </Field>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" disabled={r.busy}>
                {t('Save bank account')}
              </Button>
              <Button tone="ghost" onClick={() => setEditing(false)}>
                {t('Cancel')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

export default function StatementPage() {
  const t = useT();
  const { data, error, loading, reload } = useLoad<Statement>('/merchant/statement');
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert>{error ?? t('Could not load your statement')}</Alert>;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Merchant')}
        title={t('Money')}
        subtitle={t('Cash we collected for you, minus our fees')}
      />

      <WalletCard
        large
        icon="wallet"
        label={t('Next payout')}
        value={egp(data.balance)}
        hint={data.balance < 0 ? t('You owe this to Shiply') : t('Ready to be paid to you')}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={t('Cash collected')}
          value={egp(data.codTotal)}
          icon="cash"
          tone="delivered"
        />
        <StatCard label={t('Our fees')} value={egp(data.feesTotal)} icon="invoice" tone="primary" />
        <StatCard
          label={t('Still with couriers')}
          value={egp(data.cashStillWithCouriers)}
          hint={t('Joins the next payout once handed in')}
          icon="courier"
          tone="in-progress"
        />
      </div>

      <Card title={t('Parcels in the next payout ({n})', { n: data.shipments.length })}>
        {data.shipments.length === 0 ? (
          <Empty>{t('Nothing waiting to be settled.')}</Empty>
        ) : (
          <Table
            head={[t('Tracking'), t('Status'), t('Closed'), t('Collected'), t('Fees'), t('Net')]}
          >
            {data.shipments.map((s) => (
              <tr key={s.id}>
                <Td>
                  <Link
                    href={`/parcels/merchant/${s.id}`}
                    className="ltr-iso font-mono font-bold text-link hover:underline"
                  >
                    {s.trackingNumber}
                  </Link>
                </Td>
                <Td>
                  <StatusBadge status={s.status} />
                </Td>
                <Td className="ltr-iso">{dateTime(s.closedAt)}</Td>
                <Td className="tabular ltr-iso">{egp(s.codCollected)}</Td>
                <Td className="tabular ltr-iso">{egp(s.fees)}</Td>
                <Td className="tabular ltr-iso font-bold">{egp(s.codCollected - s.fees)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <BankCard bank={data.bank} onSaved={reload} />
      <Card title={t('Past payouts')}>
        {data.payouts.length === 0 ? (
          <Empty>{t('No payouts yet.')}</Empty>
        ) : (
          <Table
            head={[
              t('Payout'),
              t('Date'),
              t('Collected'),
              t('Fees'),
              t('Amount'),
              t('Status'),
              t('Reference'),
            ]}
          >
            {data.payouts.map((p) => (
              <tr key={p.id}>
                <Td className="ltr-iso font-mono font-bold">{p.code}</Td>
                <Td className="ltr-iso">{dateTime(p.createdAt)}</Td>
                <Td className="tabular ltr-iso">{egp(p.codTotal)}</Td>
                <Td className="tabular ltr-iso">{egp(p.feesTotal)}</Td>
                <Td className="tabular ltr-iso font-bold">{egp(p.amount)}</Td>
                <Td>
                  <RequestBadge status={p.status} />
                </Td>
                <Td className="text-text-muted">{p.reference}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

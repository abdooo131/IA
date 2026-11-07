'use client';
import { useState } from 'react';
import { useHub } from '@/parcels/components/HubContext';
import { StatCard } from '@/parcels/components/StatCard';
import {
  MoneyInput,
  RequestBadge,
  readFile,
  toPiastres,
  useRunner,
  type FileBody,
} from '@/parcels/components/money';
import {
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Table,
  Td,
} from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Safe {
  balance: number;
  waitingDeposits: number;
  available: number;
  deposits: {
    id: string;
    code: string;
    amount: number;
    reference: string;
    status: string;
    note: string;
    createdAt: string;
  }[];
}

/** Cash the couriers handed in sits in the hub safe until someone takes it to the bank. */
export default function HubSafePage() {
  const t = useT();
  const hub = useHub();
  const safe = useLoad<Safe>(`/hubs/${hub.id}/safe`);
  const r = useRunner(() => safe.reload());
  const [f, setF] = useState({ amount: '', reference: '' });
  const [receipt, setReceipt] = useState<FileBody | null>(null);
  if (!safe.data) return <Loading />;
  const s = safe.data;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={hub.name}
        title={t('Hub safe')}
        subtitle={t('Cash from closed courier runs, and deposits to the bank')}
      />
      {r.view}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t('In the safe')} value={egp(s.balance)} icon="wallet" />
        <StatCard
          label={t('Deposits waiting for finance')}
          value={egp(s.waitingDeposits)}
          icon="invoice"
          tone="in-progress"
        />
        <StatCard
          label={t('Still to deposit')}
          value={egp(s.available)}
          icon="cash"
          tone={s.available > 0 ? 'needs-action' : 'delivered'}
        />
      </div>
      <Card title={t('Record a bank deposit')}>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(async () => {
              await api(`/hubs/${hub.id}/safe/deposits`, {
                body: { amount: toPiastres(f.amount), reference: f.reference, receipt },
              });
              setF({ amount: '', reference: '' });
              setReceipt(null);
            }, 'Deposit recorded. Finance will confirm it');
          }}
        >
          <Field label={t('Amount (EGP)')}>
            <MoneyInput required value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          </Field>
          <Field label={t('Bank slip number')}>
            <Input
              required
              minLength={3}
              className="ltr-iso"
              value={f.reference}
              onChange={(e) => setF({ ...f, reference: e.target.value })}
            />
          </Field>
          <Field label={t('Slip photo')} hint={receipt?.fileName}>
            <label className="btn-secondary cursor-pointer">
              {receipt ? t('Change file') : t('Upload file')}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file).then(setReceipt);
                }}
              />
            </label>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={r.busy || s.available <= 0}>
              {t('Save deposit')}
            </Button>
          </div>
        </form>
      </Card>
      <Card title={t('Deposits')}>
        {s.deposits.length === 0 ? (
          <Empty>{t('No deposits yet')}</Empty>
        ) : (
          <Table head={[t('Deposit'), t('Amount'), t('Reference'), t('Status')]}>
            {s.deposits.map((d) => (
              <tr key={d.id}>
                <Td>
                  <span className="ltr-iso font-bold">{d.code}</span>
                  <div className="text-caption text-text-muted">{dateTime(d.createdAt)}</div>
                </Td>
                <Td>{egp(d.amount)}</Td>
                <Td>
                  <span className="ltr-iso">{d.reference}</span>
                  {d.note && <div className="text-caption text-danger">{d.note}</div>}
                </Td>
                <Td>
                  <RequestBadge status={d.status} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

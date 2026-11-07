'use client';
import { useState } from 'react';
import { WalletCard } from '@/components/WalletCard';
import { MoneyInput, RequestBadge, toPiastres, useRunner } from '@/components/money';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { toJpeg } from '../CheckInGate';

interface Wallet {
  wallet: number;
  cashToHandIn: number;
  notYetAvailable: number;
  withdrawable: number;
  paidByAgent: boolean;
  frozen: boolean;
  freezeDays: number;
  pointValue: number;
  earnings: { id: string; kind: string; points: number; amount: number; date: string; note: string; availableAt: string; settlementId: string | null }[];
  withdrawals: { id: string; code: string; amount: number; status: string; createdAt: string }[];
  payIns: { id: string; code: string; amount: number; purpose: string; status: string; reference: string; note: string; createdAt: string }[];
}

const KIND: Record<string, string> = { DELIVERY: 'Delivery', RETURN: 'Return to merchant', PICKUP: 'Pickup', BONUS: 'Bonus', PENALTY: 'Deduction', ADJUSTMENT: 'Adjustment' };

export default function CourierWallet() {
  const t = useT();
  const w = useLoad<Wallet>('/courier/wallet');
  const run = useLoad<{ id: string; code: string } | null>('/courier/run');
  const r = useRunner(() => w.reload());
  const [pay, setPay] = useState({ amount: '', purpose: 'CASH', reference: '' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [out, setOut] = useState({ amount: '', method: '' });
  if (!w.data) return w.error ? <Alert>{w.error}</Alert> : <Loading />;
  const d = w.data;

  return (
    <div className="space-y-4">
      <h1 className="text-h2">{t('My wallet')}</h1>
      {r.view}
      {d.frozen && <Alert>{t('Your wallet is negative. Recharge through Fawry before your next run, or ask finance.')}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <WalletCard large icon="wallet" label={t('Wallet')} value={egp(d.wallet)} hint={d.paidByAgent ? t('Your agent pays you at the end of the month.') : `${t('Can withdraw now')}: ${egp(d.withdrawable)}`} />
        </div>
        <div className="col-span-2">
          <WalletCard icon="cash" label={t('Cash to hand in')} value={egp(d.cashToHandIn)} />
        </div>
        {!d.paidByAgent && (
          <p className="col-span-2 text-caption text-text-muted">{t('Earnings can be withdrawn {days} days after you earn them. Waiting: {amount}', { days: d.freezeDays, amount: egp(d.notYetAvailable) })}</p>
        )}
      </div>

      <Card title={t('Pay in through Fawry')}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(async () => {
              if (!photo) throw new Error('Take a photo of the receipt');
              await api('/courier/pay-ins', {
                body: { amount: toPiastres(pay.amount), purpose: pay.purpose, channel: 'FAWRY', reference: pay.reference, runId: pay.purpose === 'CASH' ? run.data?.id ?? null : null, receipt: { fileName: 'receipt.jpg', mime: 'image/jpeg', dataBase64: photo } },
              });
              setPay({ amount: '', purpose: pay.purpose, reference: '' });
              setPhoto(null);
            }, 'Sent. Finance will check it');
          }}
        >
          <Field label={t('What for')}>
            <Select value={pay.purpose} onChange={(e) => setPay({ ...pay, purpose: e.target.value })}>
              <option value="CASH">{run.data ? t('Cash from my run {code}', { code: run.data.code }) : t('Cash I collected')}</option>
              <option value="RECHARGE">{t('Recharge my wallet')}</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('Amount (EGP)')}><MoneyInput required value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></Field>
            <Field label={t('Fawry reference')}><Input required minLength={3} className="ltr-iso" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          </div>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={t('Receipt')} className="max-h-56 rounded-lg" />
          )}
          <label className="btn-secondary w-full cursor-pointer">
            {photo ? t('Take another photo') : t('Photo of the receipt')}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void toJpeg(f).then(setPhoto); e.target.value = ''; }} />
          </label>
          <Button type="submit" className="min-h-12 w-full" disabled={r.busy || !photo}>{t('Send pay in')}</Button>
        </form>
      </Card>

      {!d.paidByAgent && (
        <Card title={t('Withdraw')}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(async () => {
                await api('/courier/withdrawals', { body: { amount: toPiastres(out.amount), method: out.method } });
                setOut({ amount: '', method: '' });
              }, 'Request sent');
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('Amount (EGP)')}><MoneyInput required value={out.amount} onChange={(v) => setOut({ ...out, amount: v })} /></Field>
              <Field label={t('Pay me by')}><Input required minLength={3} placeholder="InstaPay 010..." value={out.method} onChange={(e) => setOut({ ...out, method: e.target.value })} /></Field>
            </div>
            <Button type="submit" className="w-full" disabled={r.busy || d.withdrawable <= 0}>{t('Request withdrawal')}</Button>
          </form>
        </Card>
      )}

      {(d.payIns.length > 0 || d.withdrawals.length > 0) && (
        <Card title={t('My requests')}>
          <ul className="divide-y divide-line text-body-sm">
            {d.payIns.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <span>{t('Pay in')} <span className="ltr-iso">{p.code}</span> · {egp(p.amount)}{p.note && <span className="block text-caption text-danger">{p.note}</span>}</span>
                <RequestBadge status={p.status} />
              </li>
            ))}
            {d.withdrawals.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                <span>{t('Withdrawal')} <span className="ltr-iso">{x.code}</span> · {egp(x.amount)}</span>
                <RequestBadge status={x.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('What I earned')}>
        {d.earnings.length === 0 ? <Empty>{t('Nothing yet')}</Empty> : (
          <ul className="divide-y divide-line text-body-sm">
            {d.earnings.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {t(KIND[e.kind] ?? e.kind)} {e.points > 0 && <span className="text-caption text-text-muted">· {t('{count} points', { count: e.points })}</span>}
                  <span className="block text-caption text-text-muted"><span className="ltr-iso">{e.date}</span> {e.note}</span>
                </span>
                <span className="text-end">
                  <span className={`font-bold ${e.amount < 0 ? 'text-danger' : ''}`}>{egp(e.amount)}</span>
                  {e.settlementId ? <span className="block"><Badge tone="blue">{t('Paid by agent')}</Badge></span> : e.amount > 0 && new Date(e.availableAt) > new Date() ? <span className="block text-caption text-text-muted">{t('from {time}', { time: dateTime(e.availableAt) })}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

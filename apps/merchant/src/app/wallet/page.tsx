'use client';

import { egpToPiastres } from '@shiply/shared';
import { ApiError, Button, Card, ErrorBox, Field, formatDateTime, inputClass, memoLabel, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

type Method = 'BANK' | 'FAWRY_ACCOUNT' | 'FAWRY_CARD';

interface WalletSummary {
  balance: number;
  available: number;
  pendingCashouts: number;
  pendingSettlement: { amount: number; orders: number };
  cashoutFrequency: 'DAILY' | 'EVERY_2_DAYS' | 'WEEKLY';
  nextCashoutDate: string;
  bank: { bankName: string; accountName: string; iban: string; lastChangedAt: string } | null;
  fees: { bankFlat: number; fawryAccountBp: number; fawryCardBp: number; minAmount: number };
}
interface StatementLine {
  id: string;
  occurredAt: string;
  type: string;
  description: string;
  amount: number;
  balanceAfter: number;
  orderId: string | null;
  trackingNumber: string | null;
}
interface Cashout {
  id: string;
  amount: number;
  fee: number;
  netAmount: number;
  method: Method;
  destination: string;
  status: 'PENDING' | 'PAID' | 'REJECTED';
  auto: boolean;
  payoutReference: string | null;
  rejectReason: string | null;
  createdAt: string;
}

const STATUS_STYLE = { PENDING: 'bg-amber-50 text-amber-800', PAID: 'bg-emerald-50 text-emerald-800', REJECTED: 'bg-rose-50 text-rose-800' };

export default function WalletPage() {
  const { api, t, lang } = useApp();
  const summary = useAsync(() => api.get<WalletSummary>('/merchant/wallet'), []);
  const [page, setPage] = useState(1);
  const statement = useAsync(() => api.get<{ total: number; pageSize: number; items: StatementLine[] }>(`/merchant/wallet/statement?page=${page}`), [page]);
  const cashouts = useAsync(() => api.get<Cashout[]>('/merchant/wallet/cashouts'), []);
  const reloadAll = () => {
    summary.reload();
    statement.reload();
    cashouts.reload();
  };

  if (summary.loading && !summary.data) return <Spinner />;
  if (summary.error || !summary.data) return <ErrorBox error={summary.error} />;
  const s = summary.data;
  const nextDate = new Date(s.nextCashoutDate).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const pages = statement.data ? Math.max(1, Math.ceil(statement.data.total / statement.data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title={t.wallet} subtitle={`${t.cashoutSchedule}: ${t[`freq${s.cashoutFrequency}`]} · ${nextDate}`} />

      {s.balance < 0 && <ErrorBox error={t.negativeWallet} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div className="rounded-xl bg-ink px-6 py-5 text-white shadow-lift" data-testid="wallet-balance">
          <div className="text-xs font-medium uppercase tracking-wider text-white/60">{t.walletBalance}</div>
          <div className={`mt-2 font-display text-3xl font-semibold ${s.balance < 0 ? 'text-rose-300' : ''}`}>
            <Money value={s.balance} />
          </div>
        </div>
        <Tile label={t.availableCashout} value={<Money value={s.available} />} tone="text-emerald-700" testId="wallet-available" />
        <Tile
          label={t.onTheWay}
          value={<Money value={s.pendingSettlement.amount} />}
          hint={`${s.pendingSettlement.orders} ${t.orders.toLowerCase()} · ${t.onTheWayHint}`}
        />
        <Tile label={t.pendingCashouts} value={<Money value={s.pendingCashouts} />} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title={t.statement} flush>
          {statement.loading && !statement.data ? (
            <Spinner />
          ) : statement.data && statement.data.items.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">{t.none}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="statement">
                <thead className="text-[11px] uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 text-start font-medium">{t.date}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.description}</th>
                    <th className="px-3 py-2 text-end font-medium">{t.amount}</th>
                    <th className="px-5 py-2 text-end font-medium">{t.balanceAfter}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {statement.data?.items.map((l) => (
                    <tr key={l.id} className="hover:bg-paper">
                      <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">{formatDateTime(l.occurredAt, lang)}</td>
                      <td className="px-3 py-2.5">
                        <div>{memoLabel(l.description, t)}</div>
                        {l.trackingNumber && (
                          <Link href={`/orders/${l.orderId}`} className="font-mono text-xs text-accent-strong hover:underline">
                            {l.trackingNumber}
                          </Link>
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-end font-medium ${l.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        <span dir="ltr">{l.amount > 0 ? '+' : ''}</span>
                        <Money value={l.amount} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-end text-muted"><Money value={l.balanceAfter} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.prev}</Button>
              <span className="text-muted">{t.page} {page} {t.of} {pages}</span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t.next}</Button>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <CashoutForm summary={s} onDone={reloadAll} />
          <BankCard bank={s.bank} onSaved={summary.reload} />
          <Card title={t.cashoutHistory}>
            {(cashouts.data ?? []).length === 0 ? (
              <p className="text-sm text-muted">{t.none}</p>
            ) : (
              <ul className="space-y-3" data-testid="cashout-history">
                {cashouts.data!.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium"><Money value={c.amount} /></div>
                      <div className="truncate text-xs text-muted">
                        {t[`method${c.method}`]} · {c.destination}
                        {c.auto && ` · ${t.autoCashout}`}
                      </div>
                      <div className="text-xs text-muted">{formatDateTime(c.createdAt, lang)}</div>
                      {c.payoutReference && <div className="font-mono text-[11px] text-muted">{c.payoutReference}</div>}
                      {c.rejectReason && <div className="text-xs text-rose-700">{c.rejectReason}</div>}
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>{t[`status${c.status}`]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, hint, tone, testId }: { label: string; value: React.ReactNode; hint?: string; tone?: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card" data-testid={testId}>
      <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-2 font-display text-xl font-semibold ${tone ?? 'text-text'}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function CashoutForm({ summary, onDone }: { summary: WalletSummary; onDone: () => void }) {
  const { api, t, session } = useApp();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>(summary.bank ? 'BANK' : 'FAWRY_ACCOUNT');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwner = session?.user.role === 'MERCHANT_OWNER';
  const piastres = egpToPiastres(amount || '0') ?? 0;
  const f = summary.fees;
  const fee = method === 'BANK' ? f.bankFlat : Math.floor((piastres * (method === 'FAWRY_ACCOUNT' ? f.fawryAccountBp : f.fawryCardBp) * 2 + 10000) / 20000);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = egpToPiastres(amount);
    if (!p) return setError(new Error('Enter an amount like 500 or 500.50'));
    setBusy(true);
    try {
      await api.post('/merchant/wallet/cashouts', { amount: p, method, destination: method === 'BANK' ? null : destination });
      setAmount('');
      setOk(true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.requestCashout}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t.amountEgp} hint={`${t.availableCashout}: ${(summary.available / 100).toFixed(2)}`}>
          <div className="flex gap-2">
            <input id="cashout-amount" className={inputClass} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => { setAmount(e.target.value); setOk(false); }} disabled={!isOwner} placeholder="0.00" />
            <Button type="button" variant="secondary" onClick={() => setAmount((summary.available / 100).toFixed(2))} disabled={!isOwner || summary.available <= 0}>
              {t.max}
            </Button>
          </div>
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted">{t.method}</legend>
          <div className="grid gap-2">
            {(['BANK', 'FAWRY_ACCOUNT', 'FAWRY_CARD'] as Method[]).map((m) => (
              <label key={m} className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${method === m ? 'bg-accent-soft ring-accent' : 'ring-line hover:bg-paper'}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="method" value={m} checked={method === m} onChange={() => { setMethod(m); setOk(false); }} disabled={!isOwner} />
                  {t[`method${m}`]}
                </span>
                <span className="text-xs text-muted">{m === 'BANK' ? <Money value={f.bankFlat} /> : `${(m === 'FAWRY_ACCOUNT' ? f.fawryAccountBp : f.fawryCardBp) / 100}%`}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {method !== 'BANK' && (
          <Field label={t.destinationFawry}>
            <input id="cashout-destination" className={inputClass} dir="ltr" value={destination} onChange={(e) => setDestination(e.target.value)} disabled={!isOwner} />
          </Field>
        )}
        {method === 'BANK' && !summary.bank && <p className="text-xs text-orange-700">{t.noBank}</p>}
        {piastres > 0 && (
          <dl className="space-y-1 rounded-lg bg-paper px-3 py-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">{t.fee}</dt><dd><Money value={fee} /></dd></div>
            <div className="flex justify-between font-medium"><dt>{t.youReceive}</dt><dd><Money value={Math.max(0, piastres - fee)} /></dd></div>
          </dl>
        )}
        <ErrorBox error={error} />
        {ok && <p className="text-sm font-medium text-emerald-700">{t.cashoutRequested}</p>}
        <Button type="submit" className="w-full" disabled={!isOwner || busy || summary.available <= 0}>{t.requestCashout}</Button>
      </form>
    </Card>
  );
}

function BankCard({ bank, onSaved }: { bank: WalletSummary['bank']; onSaved: () => void }) {
  const { api, t, session } = useApp();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ bankName: '', accountName: '', iban: '' });
  const [error, setError] = useState<unknown>(null);
  const isOwner = session?.user.role === 'MERCHANT_OWNER';

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.put('/merchant/bank-details', { ...form, iban: form.iban.replace(/\s/g, '').toUpperCase() });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card title={t.bankDetails} actions={isOwner && !editing ? <Button variant="ghost" onClick={() => setEditing(true)}>{t.edit}</Button> : null}>
      {editing ? (
        <form onSubmit={save} className="space-y-3">
          <Field label={t.bankName}><input className={inputClass} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required /></Field>
          <Field label={t.accountName}><input className={inputClass} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} required /></Field>
          <Field label={t.iban} hint="EG + 27 digits"><input className={`${inputClass} font-mono`} dir="ltr" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} required /></Field>
          <p className="text-xs text-muted">{t.bankLock}</p>
          <ErrorBox error={error} />
          <div className="flex gap-2">
            <Button type="submit">{t.save}</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>{t.cancel}</Button>
          </div>
        </form>
      ) : bank ? (
        <dl className="space-y-2 text-sm">
          <div><dt className="text-xs text-muted">{t.bankName}</dt><dd>{bank.bankName}</dd></div>
          <div><dt className="text-xs text-muted">{t.accountName}</dt><dd>{bank.accountName}</dd></div>
          <div><dt className="text-xs text-muted">{t.iban}</dt><dd className="font-mono" dir="ltr">{bank.iban}</dd></div>
          <p className="pt-1 text-xs text-muted">{t.bankLock}</p>
        </dl>
      ) : (
        <p className="text-sm text-muted">{t.noBank}</p>
      )}
    </Card>
  );
}

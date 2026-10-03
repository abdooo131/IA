'use client';

import { egpToPiastres } from '@shiply/shared';
import { Button, Card, ErrorBox, Field, formatDateTime, inputClass, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { FormEvent, use, useState } from 'react';

interface StatementLine {
  id: string;
  occurredAt: string;
  journalId: string;
  type: string;
  description: string;
  amount: number;
  balanceAfter: number;
  orderId: string | null;
  trackingNumber: string | null;
}
interface WalletRow { id: string; nameEn: string; nameAr: string; balance: number; available: number; pendingCashouts: number; pendingSettlement: { amount: number; orders: number } }

export default function MerchantWalletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, t, lang, session } = useApp();
  const wallets = useAsync(() => api.get<WalletRow[]>('/finance/wallets'), []);
  const [page, setPage] = useState(1);
  const statement = useAsync(() => api.get<{ total: number; pageSize: number; items: StatementLine[] }>(`/finance/wallets/${id}/statement?page=${page}`), [id, page]);
  const [form, setForm] = useState({ kind: 'COMPENSATION', amount: '', reason: '' });
  const [error, setError] = useState<unknown>(null);
  const canWrite = ['SUPER_ADMIN', 'FINANCE'].includes(session?.user.role ?? '');
  const w = wallets.data?.find((x) => x.id === id);

  async function adjust(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = egpToPiastres(form.amount);
    if (!amount) return setError(new Error('Enter an amount like 150 or 150.50'));
    try {
      await api.post(`/finance/wallets/${id}/adjust`, { kind: form.kind, amount, reason: form.reason, idempotencyKey: crypto.randomUUID() });
      setForm({ kind: 'COMPENSATION', amount: '', reason: '' });
      wallets.reload();
      statement.reload();
    } catch (err) {
      setError(err);
    }
  }

  if (wallets.loading && !wallets.data) return <Spinner />;
  const pages = statement.data ? Math.max(1, Math.ceil(statement.data.total / statement.data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <Link href="/finance/wallets" className="text-sm text-accent-strong hover:underline">{lang === 'ar' ? '→' : '←'} {t.merchantWallets}</Link>
      <PageHeader
        title={w ? (lang === 'ar' ? w.nameAr : w.nameEn) : ''}
        subtitle={w && <>{t.walletBalance}: <Money value={w.balance} className="font-medium text-text" /> · {t.availableCashout}: <Money value={w.available} /> · {t.onTheWay}: <Money value={w.pendingSettlement.amount} /></>}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title={t.statement} flush>
          {statement.loading && !statement.data ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 text-start font-medium">{t.date}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.description}</th>
                    <th className="px-3 py-2 text-start font-medium">#</th>
                    <th className="px-3 py-2 text-end font-medium">{t.amount}</th>
                    <th className="px-5 py-2 text-end font-medium">{t.balanceAfter}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {statement.data?.items.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-muted">{t.none}</td></tr>}
                  {statement.data?.items.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">{formatDateTime(l.occurredAt, lang)}</td>
                      <td className="px-3 py-2.5">
                        <div>{l.description}</div>
                        {l.trackingNumber && <Link className="font-mono text-xs text-accent-strong hover:underline" href={`/orders/${l.orderId}`}>{l.trackingNumber}</Link>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted">{l.journalId}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-end font-medium ${l.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}><Money value={l.amount} /></td>
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

        {canWrite && (
          <Card title={t.adjust}>
            <form onSubmit={adjust} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(['COMPENSATION', 'DEDUCTION'] as const).map((k) => (
                  <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${form.kind === k ? 'bg-accent-soft ring-accent' : 'ring-line'}`}>
                    <input type="radio" name="kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />
                    {k === 'COMPENSATION' ? t.compensation : t.deduction}
                  </label>
                ))}
              </div>
              <Field label={t.amountEgp}>
                <input className={inputClass} dir="ltr" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </Field>
              <Field label={t.reason}>
                <input className={inputClass} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={3} />
              </Field>
              <p className="text-xs text-muted">
                {form.kind === 'COMPENSATION' ? 'Credits the wallet, booked as a compensation expense.' : 'Debits the wallet, booked as other income.'} Mistakes can be reversed from the journal.
              </p>
              <ErrorBox error={error} />
              <Button type="submit" className="w-full">{t.adjust}</Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

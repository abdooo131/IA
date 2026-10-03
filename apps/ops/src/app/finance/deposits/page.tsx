'use client';

import { egpToPiastres } from '@shiply/shared';
import { Button, Card, ErrorBox, Field, formatDateTime, inputClass, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import { FormEvent, useState } from 'react';

interface Deposit { id: string; kind: string; reference: string; amount: number; depositedAt: string; note: string | null; journalId: string }


export default function DepositsPage() {
  const { api, t, lang, session } = useApp();
  const KINDS = [
    { value: 'DRIVER_TO_FAWRY', label: t.depDriverToFawry, hint: t.depDriverToFawryHint },
    { value: 'DRIVER_TO_BANK', label: t.depDriverToBank, hint: t.depDriverToBankHint },
    { value: 'FAWRY_SETTLEMENT', label: t.depFawrySettlement, hint: t.depFawrySettlementHint },
  ];
  const { data, error, loading, reload } = useAsync(() => api.get<Deposit[]>('/finance/deposits'), []);
  const [form, setForm] = useState({ kind: 'DRIVER_TO_FAWRY', amount: '', reference: '', note: '' });
  const [formError, setFormError] = useState<unknown>(null);
  const canWrite = ['SUPER_ADMIN', 'FINANCE'].includes(session?.user.role ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = egpToPiastres(form.amount);
    if (!amount) return setFormError(new Error('Enter an amount like 1500 or 1500.50'));
    try {
      await api.post('/finance/deposits', { kind: form.kind, amount, reference: form.reference, note: form.note || undefined });
      setForm({ ...form, amount: '', reference: '', note: '' });
      reload();
    } catch (err) {
      setFormError(err);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t.deposits} subtitle={t.depositsSubtitle} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title={t.deposits} flush>
          {loading && !data ? (
            <Spinner />
          ) : error ? (
            <ErrorBox error={error} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 text-start font-medium">{t.date}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.type}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.paymentReference}</th>
                    <th className="px-5 py-2 text-end font-medium">{t.amount}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data!.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-muted">{t.none}</td></tr>}
                  {data!.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">{formatDateTime(d.depositedAt, lang)}</td>
                      <td className="px-3 py-2.5">
                        {KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}
                        {d.note && <div className="text-xs text-muted">{d.note}</div>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">{d.reference}</td>
                      <td className="px-5 py-2.5 text-end font-medium"><Money value={d.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {canWrite && (
          <Card title={t.recordDeposit}>
            <form onSubmit={submit} className="space-y-3">
              <Field label={t.type} hint={KINDS.find((k) => k.value === form.kind)?.hint}>
                <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </Field>
              <Field label={t.amountEgp}>
                <input className={inputClass} dir="ltr" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </Field>
              <Field label={t.paymentReference} hint={t.receiptHint}>
                <input className={`${inputClass} font-mono`} dir="ltr" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} required minLength={4} />
              </Field>
              <Field label={t.note}>
                <input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
              <ErrorBox error={formError} />
              <Button type="submit" className="w-full">{t.recordDeposit}</Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

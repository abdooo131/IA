'use client';

import { Button, ErrorBox, formatDateTime, inputClass, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import { useState } from 'react';

interface Cashout {
  id: string;
  amount: number;
  fee: number;
  netAmount: number;
  method: 'BANK' | 'FAWRY_ACCOUNT' | 'FAWRY_CARD';
  destination: string;
  status: 'PENDING' | 'PAID' | 'REJECTED';
  auto: boolean;
  payoutReference: string | null;
  rejectReason: string | null;
  createdAt: string;
  merchant: { nameEn: string; nameAr: string; code: string };
}

const TABS = ['PENDING', 'PAID', 'REJECTED'] as const;
const STATUS_STYLE = { PENDING: 'bg-amber-50 text-amber-800', PAID: 'bg-emerald-50 text-emerald-800', REJECTED: 'bg-rose-50 text-rose-800' };

export default function CashoutsPage() {
  const { api, t, lang } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]>('PENDING');
  const { data, error, loading, reload } = useAsync(() => api.get<Cashout[]>(`/finance/cashouts?status=${tab}`), [tab]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);

  async function act(id: string, kind: 'approve' | 'reject') {
    setBusy(id);
    setActionError(null);
    try {
      await api.post(`/finance/cashouts/${id}/${kind}`, kind === 'reject' ? { reason } : {});
      setRejecting(null);
      setReason('');
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  }

  const total = (data ?? []).reduce((s, c) => s + c.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t.cashouts} subtitle={t.cashoutsSubtitle} />
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((s) => (
          <button key={s} onClick={() => setTab(s)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === s ? 'bg-ink text-white' : 'text-muted ring-1 ring-inset ring-line hover:bg-surface'}`}>
            {t[`status${s}`]}
          </button>
        ))}
        {data && data.length > 0 && <span className="ms-auto text-sm text-muted">{data.length} · <Money value={total} /></span>}
      </div>
      <ErrorBox error={actionError} />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table className="min-w-full text-sm" data-testid="cashouts-table">
            <thead className="bg-paper text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t.merchant}</th>
                <th className="px-3 py-2 text-end font-medium">{t.amount}</th>
                <th className="px-3 py-2 text-end font-medium">{t.fee}</th>
                <th className="px-3 py-2 text-end font-medium">{t.netPaid}</th>
                <th className="px-3 py-2 text-start font-medium">{t.method}</th>
                <th className="px-3 py-2 text-start font-medium">{t.created}</th>
                <th className="px-4 py-2 text-end font-medium">{tab === 'PENDING' ? t.actions : t.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data!.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">{t.none}</td></tr>
              )}
              {data!.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-3 font-medium">{lang === 'ar' ? c.merchant.nameAr : c.merchant.nameEn}</td>
                  <td className="px-3 py-3 text-end font-medium"><Money value={c.amount} /></td>
                  <td className="px-3 py-3 text-end text-muted"><Money value={c.fee} /></td>
                  <td className="px-3 py-3 text-end"><Money value={c.netAmount} /></td>
                  <td className="px-3 py-3">
                    <div>{t[`method${c.method}`]}{c.auto && <span className="ms-2 rounded bg-paper px-1.5 py-0.5 text-[10px] text-muted">{t.autoCashout}</span>}</div>
                    <div className="font-mono text-xs text-muted" dir="ltr">{c.destination}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">{formatDateTime(c.createdAt, lang)}</td>
                  <td className="px-4 py-3 text-end">
                    {c.status === 'PENDING' ? (
                      rejecting === c.id ? (
                        <div className="ms-auto flex max-w-xs flex-col gap-2">
                          <input className={inputClass} placeholder={t.reason} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setRejecting(null)}>{t.cancel}</Button>
                            <Button variant="danger" disabled={reason.trim().length < 3 || busy === c.id} onClick={() => act(c.id, 'reject')}>{t.reject}</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => setRejecting(c.id)}>{t.reject}</Button>
                          <Button disabled={busy === c.id} onClick={() => act(c.id, 'approve')}>{t.approvePay}</Button>
                        </div>
                      )
                    ) : (
                      <div>
                        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>{t[`status${c.status}`]}</span>
                        {c.payoutReference && <div className="mt-1 font-mono text-[11px] text-muted">{c.payoutReference}</div>}
                        {c.rejectReason && <div className="mt-1 text-xs text-rose-700">{c.rejectReason}</div>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

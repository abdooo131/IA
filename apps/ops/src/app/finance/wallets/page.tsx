'use client';

import { ErrorBox, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';

interface WalletRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  cashoutFrequency: string;
  balance: number;
  available: number;
  pendingCashouts: number;
  pendingSettlement: { amount: number; orders: number };
}

export default function WalletsPage() {
  const { api, t, lang } = useApp();
  const { data, error, loading } = useAsync(() => api.get<WalletRow[]>('/finance/wallets'), []);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const total = data.reduce((s, w) => s + w.balance, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t.merchantWallets} subtitle={<>{t.totalOwed}: <Money value={total} className="font-medium text-text" /></>} />
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="min-w-full text-sm" data-testid="wallets-table">
          <thead className="bg-paper text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t.merchant}</th>
              <th className="px-3 py-2 text-end font-medium">{t.walletBalance}</th>
              <th className="px-3 py-2 text-end font-medium">{t.availableCashout}</th>
              <th className="px-3 py-2 text-end font-medium">{t.onTheWay}</th>
              <th className="px-3 py-2 text-end font-medium">{t.pendingCashouts}</th>
              <th className="px-4 py-2 text-start font-medium">{t.cashoutSchedule}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((w) => (
              <tr key={w.id} className="hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/finance/wallets/${w.id}`} className="font-medium text-accent-strong hover:underline">{lang === 'ar' ? w.nameAr : w.nameEn}</Link>
                  <div className="font-mono text-xs text-muted">{w.code}</div>
                </td>
                <td className={`px-3 py-3 text-end font-medium ${w.balance < 0 ? 'text-rose-700' : ''}`}><Money value={w.balance} /></td>
                <td className="px-3 py-3 text-end"><Money value={w.available} /></td>
                <td className="px-3 py-3 text-end text-muted">
                  <Money value={w.pendingSettlement.amount} />
                  <div className="text-xs">{w.pendingSettlement.orders} {t.orders.toLowerCase()}</div>
                </td>
                <td className="px-3 py-3 text-end text-muted"><Money value={w.pendingCashouts} /></td>
                <td className="px-4 py-3 text-xs text-muted">{t[`freq${w.cashoutFrequency}` as 'freqDAILY']}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

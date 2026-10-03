'use client';

import { STATUS_GROUPS, ORDER_STATUSES, OrderStatus } from '@shiply/shared';
import { Card, ErrorBox, GROUP_LABELS, Money, Spinner, STATUS_LABELS, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';

interface Dashboard {
  counts: Record<OrderStatus, number>;
  today: Record<OrderStatus, number>;
  groups: Record<string, number>;
  awaitingAction: number;
  expectedCod: number;
  collectedCod: number;
  nextCashoutDate: string | null;
}

export default function DashboardPage() {
  const { api, t, lang } = useApp();
  const { data, error, loading } = useAsync(() => api.get<Dashboard>('/orders/dashboard'), []);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const todayTotal = Object.values(data.today).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t.dashboard}</h1>

      {data.awaitingAction > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-300 bg-orange-50 p-4" data-testid="awaiting-alert">
          <div>
            <p className="font-semibold text-orange-900">
              {t.awaitingAction}: {data.awaitingAction}
            </p>
            <p className="text-sm text-orange-800">{t.awaitingWarning}</p>
          </div>
          <Link href="/orders?status=AWAITING_MERCHANT_ACTION" className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700">
            {t.viewOrders}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`${t.orders} · ${t.today}`} value={String(todayTotal)} />
        <Stat label={t.expectedCod} value={<Money value={data.expectedCod} />} />
        <Stat label={t.collectedCod} value={<Money value={data.collectedCod} />} />
        <Stat label={t.nextCashout} value={data.nextCashoutDate ?? '-'} />
      </div>

      <Card title={`${t.orders} · ${t.allTime}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STATUS_GROUPS.map((g) => (
            <Link key={g} href={`/orders?group=${g}`} className="rounded-lg border border-slate-200 p-3 hover:border-teal-400">
              <div className="text-xs text-slate-500">{GROUP_LABELS[lang][g]}</div>
              <div className="text-2xl font-semibold tabular-nums">{data.groups[g] ?? 0}</div>
            </Link>
          ))}
        </div>
      </Card>

      <Card title={`${t.status} · ${t.today} / ${t.allTime}`}>
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {ORDER_STATUSES.map((s) => (
            <Link key={s} href={`/orders?status=${s}`} className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-slate-50">
              <span className="text-slate-700">{STATUS_LABELS[lang][s]}</span>
              <span className="tabular-nums text-slate-900">
                {data.today[s]} / {data.counts[s]}
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

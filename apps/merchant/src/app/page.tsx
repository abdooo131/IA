'use client';

import { ORDER_STATUSES, OrderStatus, STATUS_GROUP_OF, StatusGroup } from '@shiply/shared';
import {
  buttonClass,
  Card,
  ErrorBox,
  GROUP_DOT,
  GROUP_LABELS,
  IconAlert,
  IconPlus,
  IconUpload,
  Money,
  PageHeader,
  Spinner,
  STATUS_LABELS,
  useApp,
  useAsync,
} from '@shiply/ui';
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

// Order of the pipeline is the real flow of a parcel.
const PIPELINE: StatusGroup[] = ['NEW', 'PENDING', 'PROCESSING', 'PAUSED', 'SUCCESSFUL', 'UNSUCCESSFUL'];

export default function DashboardPage() {
  const { api, t, lang, session } = useApp();
  const { data, error, loading } = useAsync(() => api.get<Dashboard>('/orders/dashboard'), []);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;

  const todayTotal = Object.values(data.today).reduce((a, b) => a + b, 0);
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const maxCount = Math.max(1, ...Object.values(data.counts));
  const dateLabel = new Date().toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const nextCashout = data.nextCashoutDate
    ? new Date(data.nextCashoutDate).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    : '-';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${t.welcome}${lang === 'ar' ? '،' : ','} ${session?.user.fullName.split(' ')[0] ?? ''}`}
        subtitle={dateLabel}
        actions={
          <>
            <Link href="/orders/import" className={buttonClass('secondary')}>
              <IconUpload width={16} height={16} /> {t.importCsv}
            </Link>
            <Link href="/orders/new" className={buttonClass('primary')}>
              <IconPlus width={16} height={16} /> {t.newOrder}
            </Link>
          </>
        }
      />

      {data.awaitingAction > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-orange-200 bg-orange-50 px-5 py-4" data-testid="awaiting-alert">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-100 text-orange-700">
            <IconAlert />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold text-orange-900">
              {t.awaitingAction}: <span className="tabular">{data.awaitingAction}</span>
            </p>
            <p className="text-sm text-orange-800">{t.awaitingWarning}</p>
          </div>
          <Link href="/orders?status=AWAITING_MERCHANT_ACTION" className={buttonClass('primary')}>
            {t.awaitingCta}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={t.todayCreated} value={<span className="tabular">{todayTotal}</span>} />
        <Kpi label={t.inFlightCod} value={<Money value={data.expectedCod} />} />
        <Kpi label={t.collectedCod} value={<Money value={data.collectedCod} />} tone="text-emerald-700" />
        <Kpi label={t.nextCashout} value={nextCashout} />
      </div>

      <Card title={t.pipeline}>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-paper">
          {PIPELINE.map((g) => {
            const n = data.groups[g] ?? 0;
            return n > 0 ? <span key={g} className={GROUP_DOT[g]} style={{ width: `${(n / Math.max(1, total)) * 100}%` }} title={`${GROUP_LABELS[lang][g]}: ${n}`} /> : null;
          })}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {PIPELINE.map((g) => (
            <Link key={g} href={`/orders?group=${g}`} className="group rounded-lg p-2 -m-2 hover:bg-paper">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className={`h-2 w-2 rounded-full ${GROUP_DOT[g]}`} />
                {GROUP_LABELS[lang][g]}
              </div>
              <div className="mt-1 font-display text-2xl font-semibold tabular group-hover:text-accent-strong">{data.groups[g] ?? 0}</div>
            </Link>
          ))}
        </div>
      </Card>

      <Card title={t.statusBreakdown}>
        <div className="grid grid-cols-1 gap-x-10 gap-y-1 md:grid-cols-2">
          {ORDER_STATUSES.map((s) => {
            const n = data.counts[s];
            return (
              <Link key={s} href={`/orders?status=${s}`} className={`grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-md px-2 py-1.5 hover:bg-paper ${n === 0 ? 'opacity-50' : ''}`}>
                <span className="truncate text-sm">{STATUS_LABELS[lang][s]}</span>
                <span className="flex items-baseline gap-2 text-sm tabular">
                  {data.today[s] > 0 && (
                    <span dir="ltr" className="text-xs text-accent-strong" title={t.today}>
                      +{data.today[s]}
                    </span>
                  )}
                  <span className="font-medium text-text">{n}</span>
                </span>
                <span className="col-span-2 mt-1 h-1 overflow-hidden rounded-full bg-paper">
                  <span className={`block h-full rounded-full ${GROUP_DOT[STATUS_GROUP_OF[s]]}`} style={{ width: `${(n / maxCount) * 100}%` }} />
                </span>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-2 font-display text-xl font-semibold sm:text-2xl ${tone ?? 'text-text'}`}>{value}</div>
    </div>
  );
}

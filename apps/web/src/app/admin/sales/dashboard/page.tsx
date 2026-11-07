import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { SalesMonthForm } from '@/components/sales/SalesMonthForm';
import { StatCard } from '@/components/StatCard';
import { apiGet } from '@/lib/api-server';
import { formatCount, formatEgp } from '@/lib/format';
import type { SalesMeta } from '@/lib/sales';
import {
  bpText,
  pickMonth,
  progressWidth,
  type SalesDashboard,
  shareWidth,
  type TargetRow,
} from '@/lib/sales-part2';

export const dynamic = 'force-dynamic';

/** A bar of a share (funnel, lost reasons, sources) with its number in words next to it. */
function Bar({
  label,
  value,
  width,
  note,
}: {
  label: string;
  value: string;
  width: number;
  note?: string;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-body-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular ltr-iso font-bold">{value}</span>
      </div>
      <div dir="ltr" className="relative mt-1 h-2.5 rounded-pill bg-surface-raised">
        <span
          className="absolute inset-y-0 left-0 rounded-pill bg-primary"
          style={{ width: `${width}%` }}
        />
      </div>
      {note && <p className="mt-0.5 text-caption text-text-muted">{note}</p>}
    </li>
  );
}

/** Progress against one target: the figure, the target and a bar. */
function Progress({
  value,
  target,
  bp,
}: {
  value: string;
  target: string | null;
  bp: number | null;
}) {
  return (
    <div className="min-w-[7rem]">
      <span className="tabular ltr-iso font-bold">{value}</span>
      {target && (
        <span className="text-caption text-text-muted">
          {' '}
          / <span className="ltr-iso">{target}</span>
        </span>
      )}
      <div dir="ltr" className="relative mt-1 h-2 rounded-pill bg-surface-raised">
        <span
          className={`absolute inset-y-0 left-0 rounded-pill ${bp !== null && bp >= 10_000 ? 'bg-status-delivered' : 'bg-primary'}`}
          style={{ width: `${progressWidth(bp)}%` }}
        />
      </div>
      {bp !== null && <span className="text-caption text-text-muted ltr-iso">{bpText(bp)}%</span>}
    </div>
  );
}

/**
 * Sales > Dashboard for a Cairo month: the funnel with the share going on at each stage, the
 * open pipeline's monthly fee value, win rate, days to close, lost reasons, new leads by source,
 * overdue follow ups and the leaderboard against targets. Reps see their own numbers; managers
 * see everyone or one rep.
 */
export default async function SalesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; ownerId?: string }>;
}) {
  const q = await searchParams;
  const month = pickMonth(q.month, cairoDay(new Date()).slice(0, 7));
  const meta = await apiGet<SalesMeta>('/sales/meta');
  const manager = meta.me.level === 'manage';
  const params = new URLSearchParams({ month });
  if (manager && q.ownerId) params.set('ownerId', q.ownerId);
  const [d, t, ts, locale] = await Promise.all([
    apiGet<SalesDashboard>(`/sales/dashboard?${params}`),
    getTranslations('sales.dashboard'),
    getTranslations('sales'),
    getLocale(),
  ]);
  const maxFunnel = Math.max(1, ...d.funnel.map((f) => f.count));
  const maxLost = Math.max(1, ...d.lostReasons.map((l) => l.count));
  const maxSource = Math.max(1, ...d.leadsBySource.map((l) => l.count));
  const target = (r: TargetRow, k: 'dealsWon' | 'orders') =>
    r.target ? formatCount(r.target[k]) : null;
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">
        {manager ? t('introManager') : t('intro')}
      </p>
      <SalesMonthForm
        month={month}
        people={manager ? meta.people : undefined}
        ownerId={q.ownerId ?? null}
      />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon="wallet"
          label={t('pipelineValue')}
          value={formatEgp(d.pipelineValuePiastres)}
          hint={t('openDeals', { n: d.openDeals })}
        />
        <StatCard
          icon="delivered"
          tone="delivered"
          label={t('winRate')}
          value={d.winRateBp === null ? '–' : `${bpText(d.winRateBp)}%`}
          hint={t('wonLost', { won: d.won, lost: d.lost })}
        />
        <StatCard
          icon="schedule"
          tone="in-progress"
          label={t('daysToClose')}
          value={d.avgDaysToClose === null ? '–' : String(d.avgDaysToClose)}
        />
        <StatCard icon="new" tone="new" label={t('newLeads')} value={formatCount(d.newLeads)} />
        <StatCard
          icon="alert"
          tone="needs-action"
          label={t('overdue')}
          value={formatCount(d.overdueFollowUps)}
          alert={d.overdueFollowUps > 0}
        />
        <StatCard icon="analytics" label={t('wonDeals')} value={formatCount(d.won)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="funnel" className="rounded-lg border border-line bg-surface p-4">
          <h2 id="funnel" className="text-h3">
            {t('funnel')}
          </h2>
          <p className="text-caption text-text-muted">{t('funnelHint')}</p>
          <ul className="mt-3 space-y-3">
            {d.funnel.map((f) => (
              <Bar
                key={f.stage}
                label={ts(`stages.${f.stage}`)}
                value={formatCount(f.count)}
                width={shareWidth(f.count, maxFunnel)}
                note={f.toNextBp === null ? undefined : t('toNext', { share: bpText(f.toNextBp) })}
              />
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="pipeline"
          className="rounded-lg border border-line bg-surface p-4"
        >
          <h2 id="pipeline" className="text-h3">
            {t('pipeline')}
          </h2>
          <p className="text-caption text-text-muted">{t('pipelineHint')}</p>
          <div className="mt-6">
            <ColumnChart
              title={t('pipeline')}
              valueLabel="EGP"
              height={160}
              columns={d.pipeline.map((p) => ({
                key: p.stage,
                label: ts(`stages.${p.stage}`),
                value: p.valuePiastres / 100,
                detail: `${ts(`stages.${p.stage}`)}: ${formatEgp(p.valuePiastres)} EGP · ${t('deals', { n: p.count })}`,
              }))}
            />
          </div>
        </section>

        <section aria-labelledby="lost" className="rounded-lg border border-line bg-surface p-4">
          <h2 id="lost" className="text-h3">
            {t('lostReasons')}
          </h2>
          {d.lostReasons.length === 0 ? (
            <p className="mt-2 text-body-sm text-text-muted">{t('noneLost')}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {d.lostReasons.map((l) => (
                <Bar
                  key={l.code}
                  label={l.label ? (locale === 'ar' ? l.label.ar : l.label.en) : ts('lost.other')}
                  value={formatCount(l.count)}
                  width={shareWidth(l.count, maxLost)}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="sources" className="rounded-lg border border-line bg-surface p-4">
          <h2 id="sources" className="text-h3">
            {t('leadsBySource')}
          </h2>
          {d.leadsBySource.length === 0 ? (
            <p className="mt-2 text-body-sm text-text-muted">{t('noLeads')}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {d.leadsBySource.map((l) => (
                <Bar
                  key={l.source}
                  label={ts(`sources.${l.source}`)}
                  value={formatCount(l.count)}
                  width={shareWidth(l.count, maxSource)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section
        aria-labelledby="trend"
        className="mt-6 rounded-lg border border-line bg-surface p-4"
      >
        <h2 id="trend" className="text-h3">
          {t('wonByMonth')}
        </h2>
        <div className="mt-6">
          <ColumnChart
            title={t('wonByMonth')}
            valueLabel={t('wonDeals')}
            height={140}
            columns={d.wonByMonth.map((m) => ({
              key: m.month,
              label: m.month.slice(2),
              value: m.count,
              detail: `${m.month}: ${m.count}`,
            }))}
          />
        </div>
      </section>

      <section aria-labelledby="leaders" className="mt-6">
        <h2 id="leaders" className="text-h3">
          {t('leaderboard')}
        </h2>
        {d.leaderboard.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('noReps')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-body-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                    {t('rep')}
                  </th>
                  <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                    {t('wonDeals')}
                  </th>
                  <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                    {t('orders')}
                  </th>
                  <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                    {t('revenue')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.leaderboard.map((r, i) => (
                  <tr key={r.user.id} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-semibold">
                      <span className="tabular text-text-muted">{i + 1}. </span>
                      {r.user.name}
                    </td>
                    <td className="px-3 py-2">
                      <Progress
                        value={formatCount(r.actual.dealsWon)}
                        target={target(r, 'dealsWon')}
                        bp={r.progress.dealsWon}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Progress
                        value={formatCount(r.actual.orders)}
                        target={target(r, 'orders')}
                        bp={r.progress.orders}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Progress
                        value={formatEgp(r.actual.feeRevenuePiastres)}
                        target={r.target ? formatEgp(r.target.feeRevenuePiastres) : null}
                        bp={r.progress.feeRevenue}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

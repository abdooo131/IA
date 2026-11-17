import { getTranslations } from 'next-intl/server';
import { CommissionLines, CommissionList } from '@/components/sales/CommissionList';
import { CommissionStanding } from '@/components/sales/CommissionStanding';
import { apiGet } from '@/lib/api-server';
import type { SalesMeta } from '@/lib/sales';
import { type Commissions, estimateStanding } from '@/lib/sales-part2';

export const dynamic = 'force-dynamic';

/**
 * Sales > Commission: the running month (counted fees so far against the fees target, what
 * more is needed, the commission at this level and the merchants still pending), then each
 * month as the job worked it out: hit (a draft a sales manager approves, then paid with the
 * salary or as a bonus to outsourced people), or missed / no target (closed at 0).
 */
export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string }>;
}) {
  const q = await searchParams;
  const meta = await apiGet<SalesMeta>('/sales/meta');
  const manager = meta.me.level === 'manage';
  const params = manager && q.userId ? `?userId=${encodeURIComponent(q.userId)}` : '';
  const [data, t] = await Promise.all([
    apiGet<Commissions>(`/sales/commissions${params}`),
    getTranslations('sales.commission'),
  ]);
  const waiting = data.commissions.filter((c) => c.status === 'draft');
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      {manager && (
        <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
          <label className="text-caption">
            {t('rep')}
            <select
              name="userId"
              defaultValue={q.userId ?? ''}
              className="mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
            >
              <option value="">{t('everyone')}</option>
              {meta.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
          >
            {t('show')}
          </button>
        </form>
      )}

      <section aria-labelledby="estimate" className="mt-6">
        <h2 id="estimate" className="text-h3">
          {t('estimateTitle', { month: data.month })}
        </h2>
        <p className="text-caption text-text-muted">{t('estimateHint')}</p>
        {data.estimate.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('estimateEmpty')}</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.estimate.map((e) => (
              <div key={e.user.id} className="min-w-0">
                <h3 className="mb-1 text-body font-bold">{e.user.name}</h3>
                <CommissionStanding standing={estimateStanding(e)} running />
                <CommissionLines lines={e.lines} hit={e.outcome === 'hit'} />
              </div>
            ))}
          </div>
        )}
      </section>

      {manager && waiting.length > 0 && (
        <p className="mt-6 rounded-md bg-status-needs-action/15 p-3 text-body-sm font-bold text-status-needs-action">
          {t('waiting', { n: waiting.length })}
        </p>
      )}
      <section aria-labelledby="history" className="mt-6">
        <h2 id="history" className="text-h3">
          {t('history')}
        </h2>
        <CommissionList rows={data.commissions} meId={meta.me.id} canManage={manager} />
      </section>
    </>
  );
}

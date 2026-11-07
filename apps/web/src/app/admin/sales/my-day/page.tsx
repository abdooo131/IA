import { getTranslations } from 'next-intl/server';
import { ActivityTimeline } from '@/components/sales/Activities';
import { DealsTable } from '@/components/sales/DealsTable';
import { apiGet } from '@/lib/api-server';
import type { MyDay, SalesMeta } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/**
 * My day: the follow ups that are overdue or due today, and my open deals without a next step.
 * Managers (and sales people who see every deal) can look at one rep or everyone.
 */
export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<{ ownerId?: string }>;
}) {
  const { ownerId } = await searchParams;
  const meta = await apiGet<SalesMeta>('/sales/meta');
  const canPick = !meta.me.ownOnly;
  const query =
    canPick && ownerId === 'all'
      ? '?all=true'
      : canPick && ownerId
        ? `?ownerId=${encodeURIComponent(ownerId)}`
        : '';
  const [day, t] = await Promise.all([
    apiGet<MyDay>(`/sales/my-day${query}`),
    getTranslations('sales'),
  ]);
  const canEdit = meta.me.level === 'use' || meta.me.level === 'manage';
  const who = day.ownerId ? meta.people.find((p) => p.id === day.ownerId) : null;
  const toActivity = (a: MyDay['today'][number]) => ({
    ...a,
    createdAt: a.dueAt ?? '',
  });
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h2">{t('myDay.title')}</h1>
          <p className="text-body-sm text-text-muted">
            {day.ownerId === null
              ? t('myDay.everyone')
              : day.ownerId === meta.me.id
                ? t('myDay.mine')
                : t('myDay.of', { name: who?.name ?? '' })}
          </p>
        </div>
        {canPick && (
          <form method="get" className="flex items-end gap-2">
            <label className="flex flex-col text-caption">
              <span className="text-text-muted">{t('myDay.person')}</span>
              <select
                name="ownerId"
                defaultValue={ownerId ?? ''}
                className="h-10 rounded-md border border-line-strong bg-surface px-2 text-body-sm"
              >
                <option value="">{t('myDay.me')}</option>
                <option value="all">{t('filters.everyone')}</option>
                {meta.people
                  .filter((p) => p.id !== meta.me.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <button type="submit" className="btn-secondary">
              {t('filters.apply')}
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="overdue"
          className="min-w-0 rounded-lg border border-line bg-surface p-4"
        >
          <h2 id="overdue" className="text-h3">
            {t('myDay.overdue')} <span className="text-danger">({day.overdue.length})</span>
          </h2>
          {day.overdue.length === 0 ? (
            <p className="mt-2 text-body-sm text-text-muted">{t('myDay.noneOverdue')}</p>
          ) : (
            <ActivityTimeline
              activities={day.overdue.map(toActivity)}
              canEdit={canEdit}
              showCompany
            />
          )}
        </section>
        <section
          aria-labelledby="today"
          className="min-w-0 rounded-lg border border-line bg-surface p-4"
        >
          <h2 id="today" className="text-h3">
            {t('myDay.today')} ({day.today.length})
          </h2>
          {day.today.length === 0 ? (
            <p className="mt-2 text-body-sm text-text-muted">{t('myDay.noneToday')}</p>
          ) : (
            <ActivityTimeline
              activities={day.today.map(toActivity)}
              canEdit={canEdit}
              showCompany
            />
          )}
        </section>
      </div>

      <section aria-labelledby="needs" className="mt-6">
        <h2 id="needs" className="text-h3">
          {t('list.needsNextStep')} ({day.needsNextStep.length})
        </h2>
        <p className="text-body-sm text-text-muted">{t('myDay.needsHint')}</p>
        <DealsTable deals={day.needsNextStep} empty={t('list.allPlanned')} />
      </section>
    </>
  );
}

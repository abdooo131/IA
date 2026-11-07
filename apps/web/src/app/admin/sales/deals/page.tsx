import { getTranslations } from 'next-intl/server';
import { DealsTable } from '@/components/sales/DealsTable';
import { SalesFilters, type SalesFilterValues } from '@/components/sales/SalesFilters';
import { SalesHeader } from '@/components/sales/SalesHeader';
import { apiGet } from '@/lib/api-server';
import { type DealCard, dealQuery, type SalesMeta } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/** Sales > Pipeline > List: every deal in a table, with the CSV export of the same filter. */
export default async function DealsListPage({
  searchParams,
}: {
  searchParams: Promise<SalesFilterValues & { next?: string }>;
}) {
  const filters = await searchParams;
  const meta = await apiGet<SalesMeta>('/sales/meta');
  const needsNextStep = filters.next === 'none';
  const query = dealQuery({
    ownerId: meta.me.ownOnly ? undefined : filters.ownerId,
    source: filters.source,
    q: filters.q,
    open: filters.closed === 'hide',
    needsNextStep,
  });
  const [deals, t] = await Promise.all([
    apiGet<DealCard[]>(`/sales/deals${query}`),
    getTranslations('sales'),
  ]);
  const tab = (on: boolean) =>
    `rounded-md px-3 py-2 text-body-sm font-bold ${on ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  return (
    <>
      <SalesHeader
        title={t('list.title')}
        view="list"
        canAdd={meta.me.level !== 'view'}
        extra={
          <a href={`/api/sales/deals.csv${query}`} className="btn-secondary" download>
            {t('list.export')}
          </a>
        }
      />
      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('list.tabs')}>
        <a href="/admin/sales/deals" className={tab(!needsNextStep)}>
          {t('list.all')}
        </a>
        <a href="/admin/sales/deals?next=none" className={tab(needsNextStep)}>
          {t('list.needsNextStep')}
        </a>
      </nav>
      <SalesFilters
        action="/admin/sales/deals"
        values={filters}
        people={meta.me.ownOnly ? [] : meta.people}
        withClosedToggle
      />
      <DealsTable deals={deals} empty={needsNextStep ? t('list.allPlanned') : t('list.empty')} />
    </>
  );
}

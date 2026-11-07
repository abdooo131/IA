import { getTranslations } from 'next-intl/server';
import { PipelineBoard } from '@/components/sales/PipelineBoard';
import { SalesFilters, type SalesFilterValues } from '@/components/sales/SalesFilters';
import { SalesHeader } from '@/components/sales/SalesHeader';
import { apiGet } from '@/lib/api-server';
import { type DealCard, dealQuery, type SalesMeta } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/** Sales > Pipeline: the board of deals by stage (docs/SALES.md). */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<SalesFilterValues>;
}) {
  const filters = await searchParams;
  const meta = await apiGet<SalesMeta>('/sales/meta');
  const hideClosed = filters.closed === 'hide';
  const [cards, t] = await Promise.all([
    apiGet<DealCard[]>(
      `/sales/deals${dealQuery({
        ownerId: meta.me.ownOnly ? undefined : filters.ownerId,
        source: filters.source,
        q: filters.q,
        open: hideClosed,
      })}`,
    ),
    getTranslations('sales'),
  ]);
  return (
    <>
      <SalesHeader title={t('board.title')} view="board" canAdd={meta.me.level !== 'view'} />
      <SalesFilters
        action="/admin/sales/pipeline"
        values={filters}
        people={meta.me.ownOnly ? [] : meta.people}
        withClosedToggle
      />
      <PipelineBoard
        cards={cards}
        lostReasons={meta.lostReasons}
        canEdit={meta.me.level === 'use' || meta.me.level === 'manage'}
        hideClosed={hideClosed}
      />
    </>
  );
}

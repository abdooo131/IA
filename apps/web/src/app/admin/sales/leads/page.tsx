import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AssignOwner } from '@/components/sales/AssignOwner';
import { DealsTable } from '@/components/sales/DealsTable';
import { SalesHeader } from '@/components/sales/SalesHeader';
import { apiGet } from '@/lib/api-server';
import { type DealCard, dealQuery, type SalesMeta } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/**
 * Sales > Leads: new deals from the website form, sign ups and reps. Managers see the queue of
 * leads nobody owns yet and give each to a rep; reps see their own new leads.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; source?: string }>;
}) {
  const { show, source } = await searchParams;
  const meta = await apiGet<SalesMeta>('/sales/meta');
  const manager = meta.me.level === 'manage';
  const queue = manager && show !== 'all';
  const [deals, t] = await Promise.all([
    apiGet<DealCard[]>(`/sales/deals${dealQuery({ unassigned: queue, source, stage: 'new' })}`),
    getTranslations('sales'),
  ]);
  const tab = (on: boolean) =>
    `rounded-md px-3 py-2 text-body-sm font-bold ${on ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  return (
    <>
      <SalesHeader title={t('leads.title')} canAdd={meta.me.level !== 'view'} />
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">
        {manager ? t('leads.introManager') : t('leads.intro')}
      </p>
      {manager && (
        <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('leads.tabs')}>
          <Link href="/admin/sales/leads" className={tab(queue)}>
            {t('leads.unassigned')}
          </Link>
          <Link href="/admin/sales/leads?show=all" className={tab(!queue)}>
            {t('leads.allNew')}
          </Link>
        </nav>
      )}
      <DealsTable
        deals={deals}
        empty={queue ? t('leads.emptyQueue') : t('leads.empty')}
        assign={
          manager
            ? (d) => (
                <AssignOwner
                  dealId={d.id}
                  ownerId={d.owner?.id ?? null}
                  people={meta.people}
                  company={d.company.brandName}
                />
              )
            : undefined
        }
      />
    </>
  );
}

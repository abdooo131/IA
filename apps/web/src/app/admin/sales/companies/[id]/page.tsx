import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ActivityComposer, ActivityTimeline } from '@/components/sales/Activities';
import { Contacts } from '@/components/sales/Contacts';
import { DealsTable } from '@/components/sales/DealsTable';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import { formatCount } from '@/lib/format';
import { type CompanyDetail, type SalesMeta, websiteHref } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/** One company: its details, people, deals and everything done with it. */
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [company, meta, t] = await Promise.all([
    apiGet<CompanyDetail>(`/sales/companies/${id}`),
    apiGet<SalesMeta>('/sales/meta'),
    getTranslations('sales'),
  ]);
  const canEdit = meta.me.level === 'use' || meta.me.level === 'manage';
  const website = websiteHref(company.website);
  const item = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="font-semibold [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
  return (
    <>
      <BackLink href="/admin/sales/companies" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 [overflow-wrap:anywhere]">{company.brandName}</h1>
        {canEdit && (
          <Link href={`/admin/sales/new?companyId=${company.id}`} className="btn-primary">
            {t('companies.newDeal')}
          </Link>
        )}
      </div>
      <dl className="mt-4 grid max-w-3xl gap-3 text-body-sm sm:grid-cols-3">
        {item(t('fields.source'), t(`sources.${company.source}`))}
        {item(t('list.owner'), company.owner?.name ?? t('unassigned'))}
        {item(
          t('fields.expectedOrders'),
          company.expectedMonthlyOrders === null ? (
            '–'
          ) : (
            <span className="ltr-iso">{formatCount(company.expectedMonthlyOrders)}</span>
          ),
        )}
        {item(
          t('fields.website'),
          website ? (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="ltr-iso text-link"
            >
              {company.website}
            </a>
          ) : (
            '–'
          ),
        )}
        {item(
          t('fields.shopDomain'),
          company.shopDomain ? <span className="ltr-iso">{company.shopDomain}</span> : '–',
        )}
        {item(t('fields.city'), company.city ?? '–')}
        {item(t('fields.category'), company.category ?? '–')}
        {item(
          t('fields.merchant'),
          company.merchant ? (
            <Link href={`/admin/merchants/${company.merchant.id}`} className="text-link">
              {company.merchant.name}
            </Link>
          ) : (
            '–'
          ),
        )}
      </dl>
      {company.note && (
        <p className="mt-3 max-w-3xl whitespace-pre-line text-body-sm">{company.note}</p>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="deals">
            <h2 id="deals" className="text-h3">
              {t('companies.deals')}
            </h2>
            <DealsTable deals={company.deals} empty={t('companies.noDeals')} />
          </section>
          <section aria-labelledby="activities">
            <h2 id="activities" className="text-h3">
              {t('activity.timeline')}
            </h2>
            {canEdit && (
              <div className="mt-3">
                <ActivityComposer companyId={company.id} />
              </div>
            )}
            <ActivityTimeline activities={company.activities} canEdit={canEdit} />
          </section>
        </div>
        <aside className="min-w-0">
          <Contacts companyId={company.id} contacts={company.contacts} canEdit={canEdit} />
        </aside>
      </div>
    </>
  );
}

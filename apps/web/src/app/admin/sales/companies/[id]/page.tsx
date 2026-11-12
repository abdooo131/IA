import type { DocSmartButton } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ActivityComposer, ActivityTimeline } from '@/components/sales/Activities';
import { Contacts } from '@/components/sales/Contacts';
import { DealsTable } from '@/components/sales/DealsTable';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { apiGet } from '@/lib/api-server';
import { formatCount } from '@/lib/format';
import { type CompanyDetail, type SalesMeta, websiteHref } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/**
 * One company as a document page (UX phase C step 4): breadcrumbs, previous and next, smart
 * buttons (deals, contacts, merchant), its details, deals, timeline and people, and the chatter.
 */
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [company, meta, doc, t, ta] = await Promise.all([
    apiGet<CompanyDetail>(`/sales/companies/${id}`),
    apiGet<SalesMeta>('/sales/meta'),
    apiGet<{ smart: DocSmartButton[] }>(`/sales/companies/${id}/document`),
    getTranslations('sales'),
    getTranslations('apps'),
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
    <DocumentFrame
      root={{ label: ta('names.sales'), href: '/admin/sales/pipeline' }}
      list={{ label: t('companies.title'), href: '/admin/sales/companies' }}
      id={company.id}
      number={company.brandName}
      numberLtr={false}
      title={[company.city, company.category].filter(Boolean).join(' · ') || undefined}
      status={company.merchant ? 'merchant' : 'prospect'}
      statusLabel={company.merchant ? t('fields.merchant') : t(`sources.${company.source}`)}
      flow={null}
      actions={
        canEdit ? (
          <Link href={`/admin/sales/new?companyId=${company.id}`} className="btn-primary">
            {t('companies.newDeal')}
          </Link>
        ) : undefined
      }
      smart={doc.smart}
      entityType="crm_company"
      canWrite={canEdit}
      asideFrom="xl"
    >
      <dl className="grid max-w-3xl gap-3 rounded-lg border border-line bg-surface p-4 text-body-sm sm:grid-cols-3">
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
      {company.note && <p className="max-w-3xl whitespace-pre-line text-body-sm">{company.note}</p>}
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
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
    </DocumentFrame>
  );
}

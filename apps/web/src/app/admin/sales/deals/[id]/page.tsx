import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ActivityComposer, ActivityTimeline } from '@/components/sales/Activities';
import { Contacts } from '@/components/sales/Contacts';
import { DealDetailsForm, DealStageActions } from '@/components/sales/DealActions';
import { BackLink } from '@/components/store/BackLink';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { StatusBar } from '@/components/workflow/StatusBar';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime, formatCount, formatEgp } from '@/lib/format';
import {
  type DealDetail,
  daysInStage,
  nextStepState,
  type SalesMeta,
  websiteHref,
} from '@/lib/sales';

export const dynamic = 'force-dynamic';

/**
 * One deal, as a document: its stages, the company and its people, the numbers, the activity
 * timeline with the next step, and the history of every change.
 */
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, meta, t, locale] = await Promise.all([
    apiGet<DealDetail>(`/sales/deals/${id}`),
    apiGet<SalesMeta>('/sales/meta'),
    getTranslations('sales'),
    getLocale(),
  ]);
  const canEdit = meta.me.level === 'use' || meta.me.level === 'manage';
  const now = new Date();
  const step = nextStepState({ stage: deal.stage, nextStepAt: deal.nextStep?.dueAt ?? null }, now);
  const website = websiteHref(deal.company.website);
  const item = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="font-semibold [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
  return (
    <>
      <BackLink href="/admin/sales/pipeline" />
      <h1 className="mt-2 text-h2 [overflow-wrap:anywhere]">
        <span className="ltr-iso">{deal.label}</span> · {deal.company.brandName}
      </h1>
      {deal.title && <p className="text-body-sm text-text-muted">{deal.title}</p>}
      <StatusBar flow="deal" status={deal.stage} />
      {deal.stage === 'lost' && (
        <p className="mt-3 max-w-3xl rounded-lg border border-danger bg-surface p-3 text-body-sm">
          <span className="font-bold">{t('deal.lostBecause')}</span>{' '}
          {deal.lostReasonLabel
            ? locale === 'ar'
              ? deal.lostReasonLabel.ar
              : deal.lostReasonLabel.en
            : ''}
          {deal.lostReason === 'other' && ` (${t('lost.other')})`}
          {deal.lostNote && ` · ${deal.lostNote}`}
        </p>
      )}
      {step === 'none' && (
        <p className="mt-3 max-w-3xl rounded-lg bg-status-needs-action/15 p-3 text-body-sm font-bold text-status-needs-action">
          {t('deal.noNextStep')}
        </p>
      )}
      {canEdit && (
        <DealStageActions
          dealId={deal.id}
          company={deal.company.brandName}
          stage={deal.stage}
          lostReasons={meta.lostReasons}
          ownerId={deal.owner?.id ?? null}
          people={meta.people}
          canManage={meta.me.level === 'manage'}
        />
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section
            aria-labelledby="details"
            className="rounded-lg border border-line bg-surface p-4"
          >
            <h2 id="details" className="text-h3">
              {t('deal.details')}
            </h2>
            <dl className="mt-3 grid gap-3 text-body-sm sm:grid-cols-3">
              {item(t('deal.owner'), deal.owner?.name ?? t('unassigned'))}
              {item(
                t('card.inStage'),
                t('card.days', { days: daysInStage(deal.stageChangedAt, now) }),
              )}
              {item(t('fields.source'), t(`sources.${deal.company.source}`))}
              {item(
                t('fields.expectedOrders'),
                deal.expectedMonthlyOrders === null ? (
                  '–'
                ) : (
                  <span className="ltr-iso">{formatCount(deal.expectedMonthlyOrders)}</span>
                ),
              )}
              {item(
                t('fields.expectedFee'),
                deal.expectedMonthlyFeePiastres === null ? (
                  '–'
                ) : (
                  <span className="ltr-iso">{formatEgp(deal.expectedMonthlyFeePiastres)}</span>
                ),
              )}
              {item(
                t('fields.expectedClose'),
                deal.expectedCloseDate ? (
                  <span className="ltr-iso">{deal.expectedCloseDate}</span>
                ) : (
                  '–'
                ),
              )}
              {item(
                t('fields.merchant'),
                deal.merchant ? (
                  <Link href={`/admin/merchants/${deal.merchant.id}`} className="text-link">
                    {deal.merchant.name}
                  </Link>
                ) : (
                  '–'
                ),
              )}
              {item(
                t('deal.created'),
                <span className="ltr-iso">{formatCairoDateTime(deal.createdAt, locale)}</span>,
              )}
              {deal.wonAt &&
                item(
                  t('deal.wonAt'),
                  <span className="ltr-iso">{formatCairoDateTime(deal.wonAt, locale)}</span>,
                )}
            </dl>
            {canEdit && (
              <DealDetailsForm
                dealId={deal.id}
                initial={{
                  title: deal.title,
                  expectedMonthlyOrders: deal.expectedMonthlyOrders,
                  expectedMonthlyFeePiastres: deal.expectedMonthlyFeePiastres,
                  expectedCloseDate: deal.expectedCloseDate,
                }}
              />
            )}
          </section>

          <section aria-labelledby="timeline">
            <h2 id="timeline" className="text-h3">
              {t('activity.timeline')}
            </h2>
            {canEdit && (
              <div className="mt-3">
                <ActivityComposer dealId={deal.id} defaultMode={step === 'none' ? 'plan' : 'log'} />
              </div>
            )}
            <ActivityTimeline activities={deal.activities} canEdit={canEdit} />
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section
            aria-labelledby="company"
            className="rounded-lg border border-line bg-surface p-4"
          >
            <h2 id="company" className="text-h3">
              <Link href={`/admin/sales/companies/${deal.company.id}`} className="text-link">
                {deal.company.brandName}
              </Link>
            </h2>
            <dl className="mt-2 space-y-2 text-body-sm">
              {website &&
                item(
                  t('fields.website'),
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ltr-iso text-link"
                  >
                    {deal.company.website}
                  </a>,
                )}
              {deal.company.shopDomain &&
                item(
                  t('fields.shopDomain'),
                  <span className="ltr-iso">{deal.company.shopDomain}</span>,
                )}
              {deal.company.category && item(t('fields.category'), deal.company.category)}
              {deal.company.city && item(t('fields.city'), deal.company.city)}
              {deal.company.note &&
                item(
                  t('fields.note'),
                  <span className="whitespace-pre-line font-normal">{deal.company.note}</span>,
                )}
            </dl>
          </section>
          <Contacts
            companyId={deal.company.id}
            contacts={deal.company.contacts}
            canEdit={canEdit}
          />
          <section
            aria-labelledby="stages"
            className="rounded-lg border border-line bg-surface p-4"
          >
            <h2 id="stages" className="text-h3">
              {t('deal.stageHistory')}
            </h2>
            <ol className="mt-2 space-y-1 text-body-sm">
              {deal.history.map((h) => (
                <li key={h.id}>
                  <span className="font-semibold">{t(`stages.${h.toStage}`)}</span>
                  <span className="block text-caption text-text-muted">
                    <span className="ltr-iso">{formatCairoDateTime(h.changedAt, locale)}</span>
                    {' · '}
                    {h.changedBy?.name ?? t('system')}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      <RecordHistory
        entityType="crm_deal"
        entityId={deal.id}
        path={`/sales/deals/${deal.id}/history`}
      />
    </>
  );
}

import type { DocSmartButton } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ActivityComposer, ActivityTimeline } from '@/components/sales/Activities';
import { Contacts } from '@/components/sales/Contacts';
import { DealDetailsForm, DealStageActions } from '@/components/sales/DealActions';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { ProposalPanel } from '@/components/sales/ProposalPanel';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime, formatCount, formatEgp } from '@/lib/format';
import {
  type DealDetail,
  daysInStage,
  nextStepState,
  type SalesMeta,
  websiteHref,
} from '@/lib/sales';
import type { DealProposals } from '@/lib/sales-part2';

export const dynamic = 'force-dynamic';

/**
 * One deal as a document page (UX phase C step 4): breadcrumbs back to the list with its
 * filters, previous and next, the stages as the status bar (lost apart), the stage actions,
 * smart buttons (company, contacts, proposals, activities, merchant once won), then the
 * numbers, proposals, the activity timeline with the next step (crm_activities, unchanged),
 * the company and its people; the chatter beside it holds notes, reminders and the history.
 */
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, meta, proposals, doc, t, ta, locale] = await Promise.all([
    apiGet<DealDetail>(`/sales/deals/${id}`),
    apiGet<SalesMeta>('/sales/meta'),
    apiGet<DealProposals>(`/sales/deals/${id}/proposals`),
    apiGet<{ smart: DocSmartButton[] }>(`/sales/deals/${id}/document`),
    getTranslations('sales'),
    getTranslations('apps'),
    getLocale(),
  ]);
  const canEdit = meta.me.level === 'use' || meta.me.level === 'manage';
  // A won deal with its merchant never leaves won (part 2).
  const locked = deal.stage === 'won' && !!deal.merchant;
  const contact = deal.company.contacts[0] ?? null;
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
    <DocumentFrame
      root={{ label: ta('names.sales'), href: '/admin/sales/pipeline' }}
      list={{ label: t('list.title'), href: '/admin/sales/deals' }}
      id={deal.id}
      number={deal.label}
      title={
        <>
          {deal.company.brandName}
          {deal.title && ` · ${deal.title}`}
        </>
      }
      status={deal.stage}
      statusLabel={t(`stages.${deal.stage}`)}
      flow="deal"
      actions={
        canEdit && !locked ? (
          <DealStageActions
            dealId={deal.id}
            company={deal.company.brandName}
            stage={deal.stage}
            lostReasons={meta.lostReasons}
            ownerId={deal.owner?.id ?? null}
            people={meta.people}
            canManage={meta.me.level === 'manage'}
          />
        ) : undefined
      }
      smart={doc.smart}
      entityType="crm_deal"
      canWrite={canEdit}
      asideFrom="xl"
    >
      {deal.stage === 'lost' && (
        <p className="max-w-3xl rounded-lg border border-danger bg-surface p-3 text-body-sm">
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
        <p className="max-w-3xl rounded-lg bg-status-needs-action/15 p-3 text-body-sm font-bold text-status-needs-action">
          {t('deal.noNextStep')}
        </p>
      )}
      {locked && (
        <p className="max-w-3xl rounded-lg border border-success bg-surface p-3 text-body-sm">
          {t('deal.wonLocked')}
        </p>
      )}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
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

          <div id="proposals" className="scroll-mt-20">
            <ProposalPanel
              dealId={deal.id}
              data={proposals}
              me={{ id: meta.me.id, canEdit, canManage: meta.me.level === 'manage' }}
              open={deal.stage !== 'won' && deal.stage !== 'lost'}
              expectedOrders={deal.expectedMonthlyOrders}
              contact={
                contact ? { name: contact.name, email: contact.email, phone: contact.phone } : null
              }
              hasMerchant={!!deal.merchant || !!deal.company.merchantId}
            />
          </div>

          <section aria-labelledby="timeline" id="timeline" className="scroll-mt-20">
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
    </DocumentFrame>
  );
}

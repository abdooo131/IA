import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BasataActions } from '@/components/finance/BasataActions';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BasataDepositDetail } from '@/lib/basata';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/**
 * One Basata deposit: the receipt photo large next to the amount, reference and time the rider
 * gave, the rider's cash figures, and Approve or Reject while it waits for review.
 */
export default async function BasataDepositPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, detail, profile, me, t, locale] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/basata_deposit/${id}`),
    apiGet<BasataDepositDetail>(`/finance/basata/deposits/${id}`),
    getMyProfile(),
    getCurrentUser(),
    getTranslations('basata'),
    getLocale(),
  ]);
  const d = detail.deposit;
  return (
    <DocumentPage
      doc={doc}
      showFields={false}
      actions={
        doc.actions.includes('approve') ? (
          <BasataActions
            detail={detail}
            canUse={!!profile && canDo(profile, 'accounting', 'use')}
            meId={me?.id ?? null}
          />
        ) : undefined
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <a
          href={`/api/photos/${d.photoId}`}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-lg border border-line bg-surface"
        >
          <img
            src={`/api/photos/${d.photoId}`}
            alt={t('receiptAlt', { number: d.number })}
            className="max-h-[70vh] w-full object-contain"
          />
        </a>
        <dl className="space-y-3 text-body-sm">
          <div>
            <dt className="text-text-muted">{t('fields.amount')}</dt>
            <dd className="ltr-iso text-h2">{formatEgp(d.amountPiastres)} EGP</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('fields.reference')}</dt>
            <dd className="ltr-iso text-h3">{d.reference}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('fields.depositedAt')}</dt>
            <dd className="ltr-iso">{formatCairoDateTime(d.depositedAt, locale)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('fields.sentAt')}</dt>
            <dd className="ltr-iso">{formatCairoDateTime(d.createdAt, locale)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('fields.rider')}</dt>
            <dd>
              {d.rider.name} <span className="ltr-iso text-text-muted">({d.rider.badgeCode})</span>{' '}
              · <span className="ltr-iso">{d.store.code}</span>
              {detail.rider.frozen && (
                <span className="ms-2 font-bold text-danger">{t('frozenTag')}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('fields.cashHeld')}</dt>
            <dd className="ltr-iso">{formatEgp(detail.rider.cashHeldPiastres)}</dd>
          </div>
          {detail.rider.deductedPiastres > 0 && (
            <div>
              <dt className="text-text-muted">{t('fields.deducted')}</dt>
              <dd className="ltr-iso text-danger">{formatEgp(detail.rider.deductedPiastres)}</dd>
            </div>
          )}
          {detail.rider.office && (
            <div>
              <dt className="text-text-muted">{t('fields.office')}</dt>
              <dd>{detail.rider.office.name}</dd>
            </div>
          )}
          {d.status !== 'pending' && (
            <div>
              <dt className="text-text-muted">{t('fields.decided')}</dt>
              <dd>
                {d.decidedBy}
                {d.decidedAt && (
                  <span className="ltr-iso text-text-muted">
                    {' '}
                    · {formatCairoDateTime(d.decidedAt, locale)}
                  </span>
                )}
              </dd>
              {d.rejectReason && <dd className="mt-1 text-danger">{d.rejectReason}</dd>}
              {d.status === 'approved' && (
                <dd className="mt-1 text-text-muted">
                  {t('split', {
                    held: formatEgp(d.heldPiastres ?? 0),
                    back: formatEgp(d.givenBackPiastres),
                  })}
                </dd>
              )}
            </div>
          )}
          {d.settlement && (
            <div>
              <dt className="text-text-muted">{t('fields.settlement')}</dt>
              <dd className="ltr-iso">
                {d.settlement.number} · {d.settlement.receivedOn}
              </dd>
            </div>
          )}
          <p>
            <Link href="/finance/frozen-riders" className="text-link">
              {t('frozenRidersLink')}
            </Link>
          </p>
        </dl>
      </div>
    </DocumentPage>
  );
}

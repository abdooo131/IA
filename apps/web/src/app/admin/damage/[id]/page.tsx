import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { SettleDamageForm } from '@/components/damage/SettleDamageForm';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { DamageReportRow } from '@/lib/damage-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { title as productTitle } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

interface DamageDoc {
  row: DamageReportRow;
  smart: DocSmartButton[];
  entries: { id: string; entry: string; kind: string; day: string; amount: number }[];
}

/**
 * One damage report as a document page (UX phase C): status bar, smart buttons (merchant,
 * product, store, the money it booked), what happened, the settle form while it waits (as on
 * the list before), the journal entries it booked, and the chatter.
 */
export default async function DamageReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile, t, ta, tf, td, locale] = await Promise.all([
    apiGet<DamageDoc>(`/admin/damage/${id}`),
    getMyProfile(),
    getTranslations('damage'),
    getTranslations('apps'),
    getTranslations('finance'),
    getTranslations('documents'),
    getLocale(),
  ]);
  const r = doc.row;
  const canSettle = r.status === 'pending' && canDo(profile, 'inventory', 'manage');
  const field = (label: string, value: React.ReactNode, wide = false) => (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="break-words text-body-sm">{value}</dd>
    </div>
  );
  return (
    <DocumentFrame
      root={{ label: ta('names.inventory'), href: '/admin/stock' }}
      list={{ label: ta('pages.damage'), href: '/admin/damage' }}
      id={r.id}
      number={r.sku}
      title={
        <>
          {productTitle(r, locale)} × <span className="ltr-iso">{r.quantity}</span>
        </>
      }
      status={r.status}
      statusLabel={t(`statuses.${r.status}`)}
      flow="damage"
      actions={canSettle ? <SettleDamageForm row={r} /> : undefined}
      smart={doc.smart}
      entityType="damage_report"
      canWrite={canDo(profile, 'inventory', 'use')}
    >
      <section className="rounded-lg border border-line bg-surface p-4" aria-label={td('details')}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {field(t('fields.cause'), t(`causes.${r.cause}`))}
          {field(t('fields.status'), t(`statuses.${r.status}`))}
          {field(t('fields.store'), localized(r.darkStore, locale))}
          {field(t('fields.merchant'), r.merchant.name)}
          {field(
            t('fields.reported'),
            <>
              <span className="ltr-iso">{formatCairoDateTime(r.createdAt, locale)}</span> ·{' '}
              {t('reportedBy', { name: r.reportedBy })}
            </>,
          )}
          {field(
            t('fields.value'),
            <span className="ltr-iso font-bold">{formatEgp(r.valuePiastres)} EGP</span>,
          )}
          {r.rider &&
            field(t('fields.rider'), t('rider', { name: r.rider.name, badge: r.rider.badgeCode }))}
          {r.note &&
            field(t('fields.note'), <span className="whitespace-pre-wrap">{r.note}</span>, true)}
          {r.status === 'settled' && (
            <>
              {field(
                t('fields.settled'),
                <>
                  {r.settledBy}
                  {r.settledAt && (
                    <>
                      {' · '}
                      <span className="ltr-iso">{formatCairoDateTime(r.settledAt, locale)}</span>
                    </>
                  )}
                </>,
              )}
              {field(
                t('fields.outcome'),
                <>
                  {r.compensationPiastres > 0
                    ? t('compensated', { amount: formatEgp(r.compensationPiastres) })
                    : t('merchantBore')}
                  {r.riderChargePiastres > 0 &&
                    ` · ${t('riderCharged', { amount: formatEgp(r.riderChargePiastres) })}`}
                </>,
              )}
              {r.settleNote && field(t('fields.settleNote'), r.settleNote, true)}
            </>
          )}
        </dl>
      </section>

      {doc.entries.length > 0 && (
        <section
          id="lines"
          className="overflow-x-auto rounded-lg border border-line bg-surface"
          aria-label={td('smart.entries')}
        >
          <table className="w-full text-body-sm">
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                  {td('fields.entry')}
                </th>
                <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                  {td('fields.kind')}
                </th>
                <th className="px-3 py-2 text-end text-label uppercase text-text-muted">
                  {td('fields.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.entries.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/finance/journal/${e.id}`} className="ltr-iso text-link">
                      {e.entry}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {tf.has(`kinds.${e.kind}`) ? tf(`kinds.${e.kind}`) : e.kind}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <span className="ltr-iso">{formatEgp(e.amount)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </DocumentFrame>
  );
}

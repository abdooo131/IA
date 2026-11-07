import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { formatCairoDateTime, formatCount, formatEgp } from '@/lib/format';
import { type DealCard, daysInStage, nextStepState } from '@/lib/sales';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2 align-top';

/** Deals as a table (the pipeline's list view, leads, needs a next step, a company's deals). */
export async function DealsTable({
  deals,
  empty,
  assign,
}: {
  deals: DealCard[];
  empty: string;
  /** A control per row to give the deal to a rep (the leads queue, managers only) */
  assign?: (deal: DealCard) => React.ReactNode;
}) {
  const [t, locale] = await Promise.all([getTranslations('sales'), getLocale()]);
  if (deals.length === 0) return <p className="mt-4 text-body-sm text-text-muted">{empty}</p>;
  const now = new Date();
  return (
    <div className="mt-4 max-w-full overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[720px] text-body-sm">
        <thead>
          <tr>
            <th className={th}>{t('list.deal')}</th>
            <th className={th}>{t('list.company')}</th>
            <th className={th}>{t('list.owner')}</th>
            <th className={th}>{t('list.stage')}</th>
            <th className={`${th} text-end`}>{t('card.orders')}</th>
            <th className={`${th} text-end`}>{t('card.value')}</th>
            <th className={th}>{t('card.nextStep')}</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => {
            const step = nextStepState(
              { stage: d.stage, nextStepAt: d.nextStep?.dueAt ?? null },
              now,
            );
            return (
              <tr key={d.id} className="border-t border-line">
                <td className={td}>
                  <Link href={`/admin/sales/deals/${d.id}`} className="ltr-iso font-bold text-link">
                    {d.label}
                  </Link>
                </td>
                <td className={td}>
                  <span className="font-semibold">{d.company.brandName}</span>
                  <span className="block text-caption text-text-muted">
                    {t(`sources.${d.company.source}`)}
                    {d.company.city ? ` · ${d.company.city}` : ''}
                  </span>
                </td>
                <td className={td}>{assign ? assign(d) : (d.owner?.name ?? t('unassigned'))}</td>
                <td className={td}>
                  {t(`stages.${d.stage}`)}
                  <span className="block text-caption text-text-muted">
                    {t('card.days', { days: daysInStage(d.stageChangedAt, now) })}
                  </span>
                </td>
                <td className={`${td} ltr-iso text-end`}>
                  {d.expectedMonthlyOrders === null ? '–' : formatCount(d.expectedMonthlyOrders)}
                </td>
                <td className={`${td} ltr-iso text-end`}>
                  {d.expectedMonthlyFeePiastres === null
                    ? '–'
                    : formatEgp(d.expectedMonthlyFeePiastres)}
                </td>
                <td className={td}>
                  {step === 'none' ? (
                    <span className="rounded-full bg-status-needs-action/15 px-2 py-0.5 text-caption font-bold text-status-needs-action">
                      {t('card.noNextStep')}
                    </span>
                  ) : d.nextStep ? (
                    <>
                      <span
                        className={`ltr-iso ${step === 'overdue' ? 'font-bold text-danger' : ''}`}
                      >
                        {formatCairoDateTime(d.nextStep.dueAt, locale)}
                      </span>
                      <span className="block text-caption text-text-muted">
                        {d.nextStep.subject}
                      </span>
                    </>
                  ) : (
                    '–'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

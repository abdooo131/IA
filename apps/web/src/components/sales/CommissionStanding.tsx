import type { CommissionOutcome } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatEgp } from '@/lib/format';
import { type MonthStanding, progressWidth } from '@/lib/sales-part2';

/** The result of a month against the fees target, as a pill (the running month reads softer). */
export function OutcomePill({
  outcome,
  running = false,
}: {
  outcome: CommissionOutcome;
  running?: boolean;
}) {
  const t = useTranslations('sales.commission');
  const tone =
    outcome === 'hit'
      ? 'text-status-delivered'
      : outcome === 'missed' && !running
        ? 'text-danger'
        : 'text-text-muted';
  return (
    <span className={`rounded-pill border border-line px-2.5 py-0.5 text-caption ${tone}`}>
      {running ? t(`runningOutcomes.${outcome}`) : t(`outcomes.${outcome}`)}
    </span>
  );
}

/** A table cell of a rep's month: hit or missed, the commission and merchants pending. */
export function CommissionCell({
  standing,
  running,
}: {
  standing: MonthStanding;
  running: boolean;
}) {
  const t = useTranslations('sales.commission');
  const s = standing;
  return (
    <div className="min-w-[9rem]">
      <OutcomePill outcome={s.outcome} running={running} />
      <span className="mt-1 block text-caption text-text-muted">
        {s.outcome === 'hit'
          ? t('earnsShort', { amount: formatEgp(s.commissionPiastres) })
          : s.outcome === 'missed' && running
            ? t('neededShort', { amount: formatEgp(s.neededPiastres ?? 0) })
            : t('earnsShort', { amount: formatEgp(0) })}
      </span>
      {s.pending.length > 0 && (
        <span className="block text-caption text-text-muted">
          {t('pendingCount', { n: s.pending.length })}
        </span>
      )}
    </div>
  );
}

/** Won merchants not counted yet, with how many active months each has. */
export function PendingMerchants({ pending }: { pending: MonthStanding['pending'] }) {
  const t = useTranslations('sales.commission');
  if (!pending.length) return null;
  return (
    <div className="mt-2">
      <p className="text-caption font-bold text-text-muted">{t('pendingTitle')}</p>
      <ul className="mt-0.5 space-y-0.5 text-caption text-text-muted">
        {pending.map((p) => (
          <li key={p.dealId}>
            <Link href={`/admin/sales/deals/${p.dealId}`} className="text-link">
              {p.company}
            </Link>{' '}
            ·{' '}
            {t('pendingLine', {
              active: Math.min(p.activeMonths, p.qualifyMonths),
              needed: p.qualifyMonths,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A rep's month against their fees target: counted fees with a progress bar, how much more
 * hits the target, the commission at the current level and the merchants still pending.
 */
export function CommissionStanding({
  standing,
  running,
}: {
  standing: MonthStanding;
  running: boolean;
}) {
  const t = useTranslations('sales.commission');
  const s = standing;
  const bp = s.targetPiastres ? Math.round((s.revenuePiastres * 10_000) / s.targetPiastres) : null;
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-label uppercase text-text-muted">{t('counted')}</span>
        <OutcomePill outcome={s.outcome} running={running} />
      </div>
      <p className="mt-1 text-body-sm">
        <span className="tabular ltr-iso text-h3 font-bold">{formatEgp(s.revenuePiastres)}</span>
        <span className="text-text-muted">
          {' '}
          /{' '}
          <span className="ltr-iso">
            {s.targetPiastres ? formatEgp(s.targetPiastres) : t('noTargetShort')}
          </span>{' '}
          {t('egp')}
        </span>
      </p>
      {s.targetPiastres !== null && s.targetPiastres > 0 && (
        <div
          dir="ltr"
          className="relative mt-2 h-2.5 rounded-pill bg-surface-raised"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressWidth(bp)}
          aria-label={t('counted')}
        >
          <span
            className={`absolute inset-y-0 left-0 rounded-pill ${s.outcome === 'hit' ? 'bg-status-delivered' : 'bg-primary'}`}
            style={{ width: `${progressWidth(bp)}%` }}
          />
        </div>
      )}
      <ul className="mt-2 space-y-0.5 text-caption text-text-muted">
        {s.outcome === 'no_target' ? (
          <li>{t('noTargetNote')}</li>
        ) : s.outcome === 'hit' ? (
          <li className="font-bold text-status-delivered">
            {t(running ? 'earnsSoFar' : 'earned', { amount: formatEgp(s.commissionPiastres) })}
          </li>
        ) : running ? (
          <li>{t('needed', { amount: formatEgp(s.neededPiastres ?? 0) })}</li>
        ) : (
          <li>{t('missedNote', { amount: formatEgp(s.neededPiastres ?? 0) })}</li>
        )}
        {s.outcome !== 'hit' && (
          <li>{t('wouldEarn', { amount: formatEgp(s.potentialPiastres) })}</li>
        )}
      </ul>
      <PendingMerchants pending={s.pending} />
    </div>
  );
}

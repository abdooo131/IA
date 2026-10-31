import { useLocale, useTranslations } from 'next-intl';
import { localized } from '@/lib/admin-types';
import type { DamageReportRow } from '@/lib/damage-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { title } from '@/lib/store-types';
import { SettleDamageForm } from './SettleDamageForm';

/** Damage reports as cards; admin gets the settle form on pending ones. */
export function DamageList({ rows, canSettle }: { rows: DamageReportRow[]; canSettle: boolean }) {
  const t = useTranslations('damage');
  const locale = useLocale();
  if (rows.length === 0) return <p className="mt-4 text-body text-text-muted">{t('empty')}</p>;
  return (
    <ul className="mt-4 space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-body font-bold">
                <span className="ltr-iso">{r.sku}</span> · {title(r, locale)} ×{' '}
                <span className="ltr-iso">{r.quantity}</span>
              </p>
              <p className="text-caption text-text-muted">
                {r.merchant.name} · {localized(r.darkStore, locale)} ·{' '}
                <span className="ltr-iso">{formatCairoDateTime(r.createdAt, locale)}</span> ·{' '}
                {t('reportedBy', { name: r.reportedBy })}
              </p>
            </div>
            <span className="rounded-pill border border-line px-3 py-1 text-caption font-bold">
              {t(`statuses.${r.status}`)}
            </span>
          </div>
          <p className="text-body-sm">
            {t('causeIs', { cause: t(`causes.${r.cause}`) })}
            {r.rider && ` · ${t('rider', { name: r.rider.name, badge: r.rider.badgeCode })}`}
          </p>
          {r.note && <p className="text-body-sm text-text-muted">{r.note}</p>}
          {r.status === 'settled' ? (
            <p className="text-body-sm">
              {r.compensationPiastres > 0
                ? t('compensated', { amount: formatEgp(r.compensationPiastres) })
                : t('merchantBore')}
              {r.riderChargePiastres > 0 &&
                ` · ${t('riderCharged', { amount: formatEgp(r.riderChargePiastres) })}`}
              {r.settleNote && ` · ${r.settleNote}`}
            </p>
          ) : (
            canSettle && <SettleDamageForm row={r} />
          )}
        </li>
      ))}
    </ul>
  );
}

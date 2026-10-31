import { useLocale, useTranslations } from 'next-intl';
import { localized } from '@/lib/admin-types';
import type { LocationRef } from '@/lib/transfer-types';

/** "From → To", plus "then → final store" for a first leg that stops at the hub. */
export function TransferRoute({
  from,
  to,
  finalDestination,
}: {
  from: LocationRef;
  to: LocationRef;
  finalDestination: LocationRef | null;
}) {
  const t = useTranslations('transfers');
  const locale = useLocale();
  return (
    <span>
      {localized(from, locale)}{' '}
      <span aria-hidden className="inline-block rtl:rotate-180">
        →
      </span>{' '}
      {localized(to, locale)}
      {finalDestination && (
        <span className="text-text-muted">
          {' '}
          ({t('thenTo', { store: localized(finalDestination, locale) })})
        </span>
      )}
    </span>
  );
}

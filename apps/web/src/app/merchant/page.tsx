import { getLocale, getTranslations } from 'next-intl/server';
import { CancelShipmentButton } from '@/components/merchant/CancelShipmentButton';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { MerchantShipment } from '@/lib/merchant-types';

export const dynamic = 'force-dynamic';

export default async function ShipmentsPage() {
  const [shipments, t, locale] = await Promise.all([
    apiGet<MerchantShipment[]>('/merchant/manifests'),
    getTranslations('merchant.shipments'),
    getLocale(),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      {shipments.length === 0 ? (
        <p className="mt-4 text-body text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shipments.map((s) => {
            const expected = s.lines.reduce((sum, l) => sum + l.expectedQty, 0);
            const received = s.lines.reduce((sum, l) => sum + l.receivedQty, 0);
            return (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ltr-iso text-h3">{s.reference}</span>
                  <span className="rounded-pill border border-line px-2.5 py-0.5 text-caption">
                    {t(`statuses.${s.status}`)}
                  </span>
                </div>
                <p className="text-body-sm text-text-muted">
                  {localized(s.darkStore, locale)} · {t('units', { received, expected })}
                </p>
                {s.status === 'expected' && <CancelShipmentButton id={s.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

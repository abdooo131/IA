import { getLocale, getTranslations } from 'next-intl/server';
import { CancelShipmentButton } from '@/components/merchant/CancelShipmentButton';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { MerchantShipment } from '@/lib/merchant-types';
import { title } from '@/lib/store-types';

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
                <ul className="mt-3 divide-y divide-line border-t border-line">
                  {s.lines.map((l) => {
                    const diff = l.receivedQty - l.expectedQty;
                    const started = s.status !== 'expected';
                    return (
                      <li key={l.sku} className="py-2 text-body-sm">
                        <p>
                          <span className="ltr-iso font-bold">{l.sku}</span> {title(l, locale)}
                        </p>
                        {l.expectedQty === 0 && (
                          <p className="text-caption text-text-muted">{t('extra')}</p>
                        )}
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-text-muted">
                          <span>
                            {t('expected')}{' '}
                            <span className="ltr-iso font-bold text-text">{l.expectedQty}</span>
                          </span>
                          <span>
                            {t('received')}{' '}
                            <span className="ltr-iso font-bold text-text">{l.receivedQty}</span>
                          </span>
                          {started && (
                            <span className="font-bold text-text">
                              {diff === 0
                                ? t('complete')
                                : diff < 0
                                  ? t('missing', { count: -diff })
                                  : t('over', { count: diff })}
                            </span>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                {s.status === 'expected' && <CancelShipmentButton id={s.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

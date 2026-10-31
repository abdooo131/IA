import { getLocale, getTranslations } from 'next-intl/server';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { MerchantSku } from '@/lib/merchant-types';
import { title } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function MerchantProductsPage() {
  const [skus, t, locale] = await Promise.all([
    apiGet<MerchantSku[]>('/merchant/skus'),
    getTranslations('merchant.products'),
    getLocale(),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {skus.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <p className="text-body">
              <span className="ltr-iso font-bold">{s.sku}</span> {title(s, locale)}
            </p>
            <ul className="mt-2 space-y-1 text-body-sm">
              {s.stock.map((l) => (
                <li key={l.darkStore.code} className="flex justify-between gap-2">
                  <span>{localized(l.darkStore, locale)}</span>
                  <span className="text-text-muted">
                    {t('onHand')} <span className="ltr-iso font-bold text-text">{l.onHand}</span> ·{' '}
                    {t('reserved')} <span className="ltr-iso">{l.reserved}</span>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

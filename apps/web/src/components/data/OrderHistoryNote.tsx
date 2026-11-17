import { getLocale, getTranslations } from 'next-intl/server';
import type { OrderHistory } from '@/lib/customer-types';

const day = (iso: string, locale: string) =>
  new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

/**
 * How much order history we hold of each store: a green badge when every order is in, an
 * amber note when only what Shopify gives without read_all_orders (the last 60 days) came.
 */
export async function OrderHistoryNote({
  shops,
  fromShopifyTotals,
}: {
  shops: OrderHistory[];
  /** Customers whose numbers lean on Shopify's totals, when the page shows them */
  fromShopifyTotals?: number;
}) {
  if (!shops.length) return null;
  const [t, locale] = await Promise.all([getTranslations('orderHistory'), getLocale()]);
  const partial = shops.some((s) => !s.complete);
  return (
    <section
      className={`mt-4 rounded-lg border p-3 text-body-sm bg-surface ${partial ? 'border-status-needs-action' : 'border-line'}`}
      aria-label={t('title')}
    >
      <h2 className="font-bold">{t('title')}</h2>
      <ul className="mt-1 space-y-1">
        {shops.map((s) => (
          <li key={s.shopId} className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-caption font-bold border ${s.complete ? 'border-status-delivered text-status-delivered' : 'border-status-needs-action text-status-needs-action'}`}
            >
              {s.complete ? t('complete') : t('partial')}
            </span>
            <span className="font-bold">{s.merchant}</span>
            <span className="text-text-muted">
              {s.from && s.to
                ? t('window', {
                    from: day(s.from, locale),
                    to: day(s.to, locale),
                    orders: s.orders,
                  })
                : t('empty')}
            </span>
            {!s.complete && (
              <span className="text-caption text-text-muted">
                {s.allOrdersGranted ? t('collecting') : t('notGranted')}
              </span>
            )}
          </li>
        ))}
      </ul>
      {partial && fromShopifyTotals !== undefined && fromShopifyTotals > 0 && (
        <p className="mt-2 text-caption text-text-muted">
          {t('totalsNote', { customers: fromShopifyTotals })}
        </p>
      )}
    </section>
  );
}

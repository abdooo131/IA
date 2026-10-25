import { getLocale, getTranslations } from 'next-intl/server';
import { MarkReadButton } from '@/components/merchant/MarkReadButton';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { MerchantNotification } from '@/lib/merchant-types';

export const dynamic = 'force-dynamic';

type Store = { nameEn: string; nameAr: string };
type Line = {
  sku: string;
  before?: number;
  after?: number;
  expectedQty?: number;
  receivedQty?: number;
};

export default async function NotificationsPage() {
  const [notes, t, locale] = await Promise.all([
    apiGet<MerchantNotification[]>('/merchant/notifications'),
    getTranslations('merchant.notifications'),
    getLocale(),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      {notes.length === 0 ? (
        <p className="mt-4 text-body text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {notes.map((n) => {
            const store = localized(n.data.darkStore as Store, locale);
            const lines = (n.data.lines as Line[]) ?? [];
            return (
              <li
                key={n.id}
                className={`rounded-lg border bg-surface p-4 shadow-sm ${n.readAt ? 'border-line' : 'border-primary'}`}
              >
                <p className="text-body font-bold">
                  {n.type === 'manifest_received'
                    ? t('manifest_received', { reference: String(n.data.reference), store })
                    : t('stock_count_adjusted', { store, bin: String(n.data.bin) })}
                </p>
                <p className="text-caption text-text-muted">
                  <span className="ltr-iso">
                    {new Date(n.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}
                  </span>
                </p>
                <ul className="mt-2 space-y-0.5 text-body-sm">
                  {lines.map((l) => (
                    <li key={l.sku} className="ltr-iso">
                      {n.type === 'manifest_received'
                        ? t('received', {
                            sku: l.sku,
                            received: l.receivedQty ?? 0,
                            expected: l.expectedQty ?? 0,
                          })
                        : t('line', { sku: l.sku, before: l.before ?? 0, after: l.after ?? 0 })}
                    </li>
                  ))}
                </ul>
                {!n.readAt && <MarkReadButton id={n.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

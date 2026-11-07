import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { type AdminStockRow, type AdminStore, localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { formatCount } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const storeId = (await searchParams).store;
  const [stores, rows, t, locale] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<AdminStockRow[]>(
      `/admin/stock${storeId ? `?darkStoreId=${encodeURIComponent(storeId)}` : ''}`,
    ),
    getTranslations('admin.stock'),
    getLocale(),
  ]);
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2';
  const pill = (active: boolean) =>
    `rounded-pill border px-3 py-1.5 text-body-sm font-bold ${
      active ? 'border-transparent bg-selected-bg text-link' : 'border-line bg-surface text-text'
    }`;

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/admin/stock" className={pill(!storeId)}>
          {t('allStores')}
        </Link>
        {stores.map((s) => (
          <Link key={s.id} href={`/admin/stock?store=${s.id}`} className={pill(storeId === s.id)}>
            {localized(s, locale)}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-body-sm text-text-muted">{t('note')}</p>

      {rows.length === 0 ? (
        <p className="mt-6 text-body">{t('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[640px] text-body-sm">
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                {!storeId && <th className={th}>{t('store')}</th>}
                <th className={th}>{t('product')}</th>
                <th className={`${th} text-end`}>{t('onHand')}</th>
                <th className={`${th} text-end`}>{t('reserved')}</th>
                <th className={`${th} text-end`}>{t('available')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.darkStore.id}:${r.sku.id}`}
                  className="border-b border-line last:border-0"
                >
                  {!storeId && <td className={td}>{localized(r.darkStore, locale)}</td>}
                  <td className={td}>
                    <span className="ltr-iso font-bold">{r.sku.sku}</span>{' '}
                    {locale === 'ar' ? r.sku.titleAr : r.sku.titleEn}
                  </td>
                  <td className={`${td} text-end`}>
                    <span className="ltr-iso">{formatCount(r.onHand)}</span>
                  </td>
                  <td className={`${td} text-end`}>
                    <span className="ltr-iso">{formatCount(r.reserved)}</span>
                  </td>
                  <td className={`${td} text-end`}>
                    <span className="ltr-iso font-bold">{formatCount(r.available)}</span>
                    {r.lowStock && (
                      <span className="ms-2 inline-flex items-center gap-1 rounded-pill border border-line px-2 py-0.5 text-caption">
                        <span aria-hidden className="h-2 w-2 rounded-full bg-status-needs-action" />
                        {t('low')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

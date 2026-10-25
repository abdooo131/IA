import { getLocale, getTranslations } from 'next-intl/server';
import type { AdminSku } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { formatCount, formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  const [skus, t, locale] = await Promise.all([
    apiGet<AdminSku[]>('/admin/skus'),
    getTranslations('admin.products'),
    getLocale(),
  ]);
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <div className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[720px] text-body-sm">
          <thead className="border-b border-line bg-surface-raised">
            <tr>
              <th className={th}>{t('sku')}</th>
              <th className={th}>{t('name')}</th>
              <th className={th}>{t('merchant')}</th>
              <th className={`${th} text-end`}>{t('price')}</th>
              <th className={`${th} text-end`}>{t('onHand')}</th>
              <th className={`${th} text-end`}>{t('reserved')}</th>
              <th className={th}>{t('shopify')}</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className={`${td} font-bold`}>
                  <span className="ltr-iso">{s.sku}</span>
                  {s.barcode && (
                    <div className="text-caption font-normal text-text-muted">
                      <span className="ltr-iso">{s.barcode}</span>
                    </div>
                  )}
                </td>
                <td className={td}>{locale === 'ar' ? s.titleAr : s.titleEn}</td>
                <td className={td}>{s.merchant.name}</td>
                <td className={`${td} text-end`}>
                  <span className="ltr-iso">{formatEgp(s.pricePiastres)}</span>
                </td>
                <td className={`${td} text-end`}>
                  <span className="ltr-iso">{formatCount(s.unitsOnHand)}</span>
                </td>
                <td className={`${td} text-end`}>
                  <span className="ltr-iso">{formatCount(s.unitsReserved)}</span>
                </td>
                <td className={`${td} text-text-muted`}>
                  {s.shopifyVariantId ? t('linked') : t('notLinked')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

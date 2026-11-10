import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { ProductEditor } from '@/components/admin/ProductsManager';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface ProductDoc {
  row: {
    id: string;
    sku: string;
    barcode: string | null;
    titleEn: string;
    titleAr: string;
    pricePiastres: number;
    weightGrams: number | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    merchant: { id: string; name: string };
    shopify: {
      variantId: string;
      productId: string | null;
      title: string | null;
      imageUrl: string | null;
      adminUrl: string | null;
    } | null;
    orderLines: number;
    stock: {
      darkStore: { id: string; code: string; nameEn: string; nameAr: string; kind: string };
      onHand: number;
      reserved: number;
      available: number;
    }[];
  };
  smart: DocSmartButton[];
}

/**
 * One product as a document page (UX phase C step 3): the merchant, barcode, price, weight,
 * the Shopify link, stock per store (on shelves, reserved, available after the store's buffer),
 * Edit for merchants use, and the chatter.
 */
export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile, t, ta, td, locale] = await Promise.all([
    apiGet<ProductDoc>(`/admin/skus/${encodeURIComponent(id)}/document`),
    getMyProfile(),
    getTranslations('admin.productPage'),
    getTranslations('apps'),
    getTranslations('documents'),
    getLocale(),
  ]);
  const p = doc.row;
  const th = 'px-3 py-2 text-label uppercase text-text-muted';
  const field = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="break-words text-body-sm">{value}</dd>
    </div>
  );
  const totals = p.stock.reduce(
    (s, l) => ({
      onHand: s.onHand + l.onHand,
      reserved: s.reserved + l.reserved,
      available: s.available + l.available,
    }),
    { onHand: 0, reserved: 0, available: 0 },
  );
  return (
    <DocumentFrame
      root={{ label: ta('names.merchants'), href: '/admin/merchants' }}
      list={{ label: ta('pages.products'), href: '/admin/products' }}
      id={p.id}
      number={p.sku}
      title={locale === 'ar' ? p.titleAr : p.titleEn}
      status={p.isActive ? 'active' : 'inactive'}
      statusLabel={p.isActive ? t('active') : t('inactive')}
      flow={null}
      actions={
        canDo(profile, 'merchants', 'use') ? (
          <ProductEditor
            sku={{
              id: p.id,
              sku: p.sku,
              barcode: p.barcode,
              titleEn: p.titleEn,
              titleAr: p.titleAr,
              pricePiastres: p.pricePiastres,
              weightGrams: p.weightGrams,
              isActive: p.isActive,
            }}
          />
        ) : undefined
      }
      smart={doc.smart}
      entityType="sku"
      canWrite={canDo(profile, 'merchants', 'use')}
    >
      <section className="rounded-lg border border-line bg-surface p-4" aria-label={td('details')}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {field(t('merchant'), p.merchant.name)}
          {field(t('barcode'), <span className="ltr-iso">{p.barcode ?? t('none')}</span>)}
          {field(t('titleEn'), <span dir="ltr">{p.titleEn}</span>)}
          {field(t('titleAr'), <span dir="rtl">{p.titleAr}</span>)}
          {field(t('price'), <span className="ltr-iso">{formatEgp(p.pricePiastres)}</span>)}
          {field(
            t('weight'),
            <span className="ltr-iso">
              {p.weightGrams === null ? t('none') : t('grams', { grams: p.weightGrams })}
            </span>,
          )}
          {field(t('orderLines'), <span className="ltr-iso">{p.orderLines}</span>)}
          {field(
            t('updated'),
            <span className="ltr-iso">{formatCairoDateTime(p.updatedAt, locale)}</span>,
          )}
        </dl>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4" aria-label={t('shopify')}>
        <h2 className="text-h3">{t('shopify')}</h2>
        {p.shopify ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {p.shopify.imageUrl && (
              // Shopify's CDN picture: a small thumbnail, not worth the image optimiser.
              <img
                src={p.shopify.imageUrl}
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 rounded-md border border-line object-cover"
              />
            )}
            <div className="min-w-0 text-body-sm">
              <p className="font-bold">{p.shopify.title ?? t('linked')}</p>
              <p className="ltr-iso break-all text-caption text-text-muted">
                {p.shopify.variantId}
              </p>
              {p.shopify.adminUrl && (
                <a
                  href={p.shopify.adminUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-link"
                >
                  {t('openInShopify')}
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-1 text-body-sm text-text-muted">{t('notLinked')}</p>
        )}
      </section>

      <section
        id="stock"
        className="scroll-mt-20 overflow-x-auto rounded-lg border border-line bg-surface"
        aria-label={t('stock')}
      >
        {p.stock.length === 0 ? (
          <p className="p-4 text-body-sm text-text-muted">{t('noStock')}</p>
        ) : (
          <table className="w-full min-w-[420px] text-body-sm">
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th className={`${th} text-start`}>{t('store')}</th>
                <th className={`${th} text-end`}>{t('available')}</th>
                <th className={`${th} text-end`}>{t('onHand')}</th>
                <th className={`${th} text-end`}>{t('reserved')}</th>
              </tr>
            </thead>
            <tbody>
              {p.stock.map((l) => (
                <tr key={l.darkStore.id} className="border-b border-line">
                  <td className="px-3 py-2">
                    {localized(l.darkStore, locale)}{' '}
                    <span className="ltr-iso text-text-muted">({l.darkStore.code})</span>
                  </td>
                  <td className="ltr-iso px-3 py-2 text-end font-bold">{l.available}</td>
                  <td className="ltr-iso px-3 py-2 text-end">{l.onHand}</td>
                  <td className="ltr-iso px-3 py-2 text-end">{l.reserved}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className="px-3 py-2">{t('total')}</td>
                <td className="ltr-iso px-3 py-2 text-end">{totals.available}</td>
                <td className="ltr-iso px-3 py-2 text-end">{totals.onHand}</td>
                <td className="ltr-iso px-3 py-2 text-end">{totals.reserved}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </DocumentFrame>
  );
}

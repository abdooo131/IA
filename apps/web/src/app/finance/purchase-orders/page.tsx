import { canDo } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { NewPurchaseOrder } from '@/components/finance/PurchaseOrders';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount, StoreOption, SupplierRow } from '@/lib/finance-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import type { PackagingItem, PurchaseOrderRow } from '@/lib/purchasing-types';

export const dynamic = 'force-dynamic';

const STATUSES = ['requested', 'approved', 'ordered', 'received', 'billed', 'closed'] as const;
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; supplierId?: string }>;
}) {
  const q = await searchParams;
  const status = STATUSES.find((s) => s === q.status) ?? '';
  // A supplier's page opens its orders (?supplierId=); the status filter keeps it.
  const supplierId =
    typeof q.supplierId === 'string' && /^[\w-]{1,40}$/.test(q.supplierId) ? q.supplierId : '';
  const query = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
  }).toString();
  const filterHref = (s: string) => {
    const p = new URLSearchParams({
      ...(s ? { status: s } : {}),
      ...(supplierId ? { supplierId } : {}),
    });
    const text = p.toString();
    return text ? `/finance/purchase-orders?${text}` : '/finance/purchase-orders';
  };
  const [orders, me, t, tw, locale] = await Promise.all([
    apiGet<PurchaseOrderRow[]>(`/finance/purchase-orders${query ? `?${query}` : ''}`),
    getMyProfile(),
    getTranslations('purchasing.orders'),
    getTranslations('workflow'),
    getLocale(),
  ]);
  // Asking for a purchase needs the prepare level (accounting use).
  const form = canDo(me, 'accounting', 'use')
    ? await Promise.all([
        apiGet<SupplierRow[]>('/finance/suppliers'),
        apiGet<StoreOption[]>('/finance/stores'),
        apiGet<PackagingItem[]>('/packaging/items'),
        apiGet<BookAccount[]>('/finance/accounts'),
      ])
    : null;
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('filter')}>
        {(['', ...STATUSES] as const).map((s) => (
          <a
            key={s || 'all'}
            href={filterHref(s)}
            aria-current={status === s ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-body-sm ${
              status === s ? 'border-primary bg-selected-bg font-bold text-link' : 'border-line'
            }`}
          >
            {s ? tw(`states.${s}`) : t('all')}
          </a>
        ))}
      </nav>
      {supplierId && (
        <p className="mt-2 text-body-sm">
          {t('forSupplier', { name: orders[0]?.supplier.name ?? '' })}{' '}
          <a href="/finance/purchase-orders" className="text-link">
            {t('allSuppliers')}
          </a>
        </p>
      )}
      {orders.length === 0 ? (
        <p className="mt-4 text-body-sm text-text-muted">{t('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('number')}</th>
                <th className={th}>{t('supplier')}</th>
                <th className={th}>{t('store')}</th>
                <th className={th}>{t('state')}</th>
                <th className={`${th} text-end`}>{t('total')}</th>
                <th className={th}>{t('requestedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className={td}>
                    <a href={`/finance/purchase-orders/${o.id}`} className="font-bold text-link">
                      {o.label}
                    </a>
                  </td>
                  <td className={td}>{o.supplier.name}</td>
                  <td className={td}>
                    {o.darkStore ? (locale === 'ar' ? o.darkStore.nameAr : o.darkStore.nameEn) : ''}
                  </td>
                  <td className={td}>
                    {tw(`states.${o.status}`)}
                    {o.partlyReceived && (
                      <span className="block text-caption text-text-muted">
                        {t('partly', { share: Math.round(o.receivedShare * 100) })}
                      </span>
                    )}
                  </td>
                  <td className={`${td} text-end`}>{formatEgp(o.totalPiastres)}</td>
                  <td className={td}>
                    {o.requestedBy.name}
                    <span className="ltr-iso block text-caption text-text-muted">
                      {formatCairoDateTime(o.createdAt, locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <NewPurchaseOrder suppliers={form[0]} stores={form[1]} items={form[2]} accounts={form[3]} />
      )}
    </>
  );
}

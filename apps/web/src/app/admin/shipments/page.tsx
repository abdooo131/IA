import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  reference: string;
  status: 'expected' | 'receiving' | 'received' | 'cancelled';
  createdAt: string;
  merchant: { id: string; name: string };
  darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  expectedUnits: number;
  receivedUnits: number;
}

const STATUSES = ['expected', 'receiving', 'received', 'cancelled'] as const;

export default async function AdminShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; store?: string; merchant?: string; q?: string }>;
}) {
  const filters = await searchParams;
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.store) query.set('darkStoreId', filters.store);
  if (filters.merchant) query.set('merchantId', filters.merchant);
  if (filters.q) query.set('q', filters.q);

  const [rows, stores, merchants, t, statuses, locale] = await Promise.all([
    apiGet<Row[]>(`/admin/manifests?${query}`),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<{ id: string; name: string }[]>('/admin/merchants'),
    getTranslations('admin.shipments'),
    getTranslations('merchant.shipments.statuses'),
    getLocale(),
  ]);
  const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <select
          name="status"
          defaultValue={filters.status ?? ''}
          className={field}
          aria-label={t('allStatuses')}
        >
          <option value="">{t('allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statuses(s)}
            </option>
          ))}
        </select>
        <select
          name="store"
          defaultValue={filters.store ?? ''}
          className={field}
          aria-label={t('allStores')}
        >
          <option value="">{t('allStores')}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {localized(s, locale)}
            </option>
          ))}
        </select>
        <select
          name="merchant"
          defaultValue={filters.merchant ?? ''}
          className={field}
          aria-label={t('allMerchants')}
        >
          <option value="">{t('allMerchants')}</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder={t('search')}
          dir="ltr"
          className={`${field} w-44`}
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('apply')}
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-body text-text-muted">{t('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-body-sm">
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th className={th}>{t('reference')}</th>
                <th className={th}>{t('merchant')}</th>
                <th className={th}>{t('store')}</th>
                <th className={th}>{t('created')}</th>
                <th className={`${th} text-end`}>{t('units')}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/admin/shipments/${r.id}`} className="ltr-iso font-bold text-link">
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.merchant.name}</td>
                  <td className="px-3 py-2">{localized(r.darkStore, locale)}</td>
                  <td className="ltr-iso px-3 py-2">{formatCairoDateTime(r.createdAt, locale)}</td>
                  <td className="ltr-iso px-3 py-2 text-end">
                    {r.receivedUnits} / {r.expectedUnits}
                  </td>
                  <td className="px-3 py-2 text-caption">{statuses(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

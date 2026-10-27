import { getTranslations } from 'next-intl/server';
import { ReturnsTable } from '@/components/returns/ReturnsTable';
import { apiGet } from '@/lib/api-server';
import type { ReturnListItem } from '@/lib/return-types';

export const dynamic = 'force-dynamic';

const STATUSES = ['requested', 'picking', 'ready', 'collected', 'cancelled'] as const;

export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const [rows, t] = await Promise.all([
    apiGet<ReturnListItem[]>(`/admin/returns${query}`),
    getTranslations('returns'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <select
          name="status"
          defaultValue={status ?? ''}
          aria-label={t('allStatuses')}
          className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
        >
          <option value="">{t('allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('apply')}
        </button>
      </form>
      <ReturnsTable rows={rows} linkBase="/admin/returns" showMerchant />
    </>
  );
}

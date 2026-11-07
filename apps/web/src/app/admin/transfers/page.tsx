import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { TransfersTable } from '@/components/transfers/TransfersTable';
import { apiGet } from '@/lib/api-server';
import type { TransferListItem } from '@/lib/transfer-types';

export const dynamic = 'force-dynamic';

const STATUSES = ['draft', 'approved', 'picking', 'in_transit', 'received', 'cancelled'] as const;

export default async function AdminTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const [rows, t] = await Promise.all([
    apiGet<TransferListItem[]>(`/admin/transfers${query}`),
    getTranslations('transfers'),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2">{t('title')}</h1>
        <div className="flex gap-2">
          <Link
            href="/admin/transfers/refill"
            className="flex h-10 items-center rounded-md border border-line bg-surface px-4 font-bold"
          >
            {t('refillLink')}
          </Link>
          <Link
            href="/admin/transfers/new"
            className="flex h-10 items-center rounded-md bg-primary px-4 font-bold text-on-primary"
          >
            {t('new')}
          </Link>
        </div>
      </div>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
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
      <TransfersTable rows={rows} linkBase="/admin/transfers" />
    </>
  );
}

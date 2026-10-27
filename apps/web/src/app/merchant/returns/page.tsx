import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ReturnsTable } from '@/components/returns/ReturnsTable';
import { apiGet } from '@/lib/api-server';
import type { ReturnListItem } from '@/lib/return-types';

export const dynamic = 'force-dynamic';

export default async function MerchantReturnsPage() {
  const [rows, t] = await Promise.all([
    apiGet<ReturnListItem[]>('/merchant/returns'),
    getTranslations('returns'),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2">{t('title')}</h1>
        <Link
          href="/merchant/returns/new"
          className="flex h-10 items-center rounded-md bg-primary px-4 font-bold text-on-primary"
        >
          {t('new')}
        </Link>
      </div>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
      <ReturnsTable rows={rows} linkBase="/merchant/returns" />
    </>
  );
}

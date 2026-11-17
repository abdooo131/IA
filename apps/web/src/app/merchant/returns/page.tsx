import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { DamageList } from '@/components/damage/DamageList';
import { ReturnsTable } from '@/components/returns/ReturnsTable';
import { apiGet } from '@/lib/api-server';
import type { DamageReportRow } from '@/lib/damage-types';
import type { ReturnListItem } from '@/lib/return-types';

export const dynamic = 'force-dynamic';

export default async function MerchantReturnsPage() {
  const [rows, damage, t, td] = await Promise.all([
    apiGet<ReturnListItem[]>('/merchant/returns'),
    apiGet<DamageReportRow[]>('/merchant/returns/damage'),
    getTranslations('returns'),
    getTranslations('damage'),
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
      <h2 className="mt-10 text-h3">{td('merchantTitle')}</h2>
      <p className="mt-1 text-body-sm text-text-muted">{td('merchantIntro')}</p>
      <DamageList rows={damage} canSettle={false} />
    </>
  );
}

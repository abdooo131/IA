import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { SalesMonthForm } from '@/components/sales/SalesMonthForm';
import { TargetsEditor } from '@/components/sales/TargetsEditor';
import { apiGet } from '@/lib/api-server';
import type { SalesMeta } from '@/lib/sales';
import { pickMonth, type TargetRow } from '@/lib/sales-part2';

export const dynamic = 'force-dynamic';

/**
 * Sales > Targets: each rep's month, deals won, delivered orders and fees (before VAT) of the
 * merchants they won, against the targets the sales managers set here.
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const q = await searchParams;
  const month = pickMonth(q.month, cairoDay(new Date()).slice(0, 7));
  const [data, meta, t] = await Promise.all([
    apiGet<{ month: string; rows: TargetRow[] }>(`/sales/targets?month=${month}`),
    apiGet<SalesMeta>('/sales/meta'),
    getTranslations('sales.targets'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <SalesMonthForm month={month} />
      <TargetsEditor rows={data.rows} month={month} canEdit={meta.me.level === 'manage'} />
    </>
  );
}

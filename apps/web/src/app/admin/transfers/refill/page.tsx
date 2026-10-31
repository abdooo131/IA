import { getTranslations } from 'next-intl/server';
import { type RefillOverview, RefillManager } from '@/components/transfers/RefillManager';
import { apiGet } from '@/lib/api-server';
import type { TransferListItem } from '@/lib/transfer-types';

export const dynamic = 'force-dynamic';

export default async function RefillPage() {
  const [data, drafts, t] = await Promise.all([
    apiGet<RefillOverview>('/admin/refill'),
    apiGet<TransferListItem[]>('/admin/transfers?status=draft'),
    getTranslations('refill'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
      <RefillManager data={data} drafts={drafts.length} />
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import { MissingReceipts } from '@/components/finance/MissingReceipts';
import { apiGet } from '@/lib/api-server';
import type { MissingReceipt } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceReceiptsPage() {
  const [missing, t] = await Promise.all([
    apiGet<{ count: number; entries: MissingReceipt[] }>('/finance/attachments/missing'),
    getTranslations('finance.receipts'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">
        {t('intro', { count: missing.count })}
      </p>
      <MissingReceipts entries={missing.entries} />
    </>
  );
}

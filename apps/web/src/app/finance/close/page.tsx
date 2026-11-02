import { getTranslations } from 'next-intl/server';
import { CloseBooks } from '@/components/finance/CloseBooks';
import { apiGet } from '@/lib/api-server';
import type { FinanceControls } from '@/lib/finance-types';
import { getCurrentUser } from '@/lib/server-session';
import { FinanceTabs } from '@/components/finance/FinanceTabs';

export const dynamic = 'force-dynamic';

export default async function FinanceClosePage() {
  const [controls, me, t] = await Promise.all([
    apiGet<FinanceControls>('/finance/controls'),
    getCurrentUser(),
    getTranslations('finance.close'),
  ]);
  return (
    <>
      <FinanceTabs family="closing" />
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <CloseBooks lock={controls.lock} isAdmin={me?.role === 'admin'} />
    </>
  );
}

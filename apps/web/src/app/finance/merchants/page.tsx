import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { MerchantWallets } from '@/components/finance/MerchantWallets';
import { apiGet } from '@/lib/api-server';
import type { FinanceOverview } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceMerchantsPage() {
  const [overview, t] = await Promise.all([
    apiGet<FinanceOverview>('/finance/overview'),
    getTranslations('finance.merchants'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <MerchantWallets merchants={overview.merchants} today={cairoDay(new Date())} />
    </>
  );
}

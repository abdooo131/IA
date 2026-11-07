import { getTranslations } from 'next-intl/server';
import { RiderWallets } from '@/components/finance/RiderWallets';
import { apiGet } from '@/lib/api-server';
import type { FinanceOverview } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceRidersPage() {
  const [overview, t] = await Promise.all([
    apiGet<FinanceOverview>('/finance/overview'),
    getTranslations('finance.riders'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <RiderWallets riders={overview.riders} />
    </>
  );
}

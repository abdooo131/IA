import { getTranslations } from 'next-intl/server';
import { RiderWallets } from '@/components/finance/RiderWallets';
import { apiGet } from '@/lib/api-server';
import type { RiderWalletRow } from '@/lib/rider-wallet';

export const dynamic = 'force-dynamic';

export default async function FinanceRidersPage() {
  const [riders, t] = await Promise.all([
    apiGet<RiderWalletRow[]>('/finance/rider-wallets'),
    getTranslations('finance.riders'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <RiderWallets riders={riders} />
    </>
  );
}

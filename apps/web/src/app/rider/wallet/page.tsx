import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { RiderWallet } from '@/components/rider/RiderWallet';
import { apiGet } from '@/lib/api-server';
import type { RiderWalletView } from '@/lib/rider-wallet';

export const dynamic = 'force-dynamic';

/** Rider pay (CLAUDE.md "Rider pay"): the rider's own wallet and withdrawals. */
export default async function RiderWalletPage() {
  const [wallet, t] = await Promise.all([
    apiGet<RiderWalletView>('/rider/wallet'),
    getTranslations('riderPay'),
  ]);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">
        <Link href="/rider" className="text-body-sm font-semibold text-link">
          {t('backHome')}
        </Link>
        <h1 className="mb-4 mt-2 text-h2">{t('title')}</h1>
        <RiderWallet wallet={wallet} />
      </main>
    </div>
  );
}

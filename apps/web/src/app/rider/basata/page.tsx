import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { RiderBasata } from '@/components/rider/RiderBasata';
import { apiGet } from '@/lib/api-server';
import type { RiderBasataView } from '@/lib/basata';

export const dynamic = 'force-dynamic';

/** Basata cash deposits: the rider deposits the cash they collected and sends the receipt. */
export default async function RiderBasataPage() {
  const [view, t] = await Promise.all([
    apiGet<RiderBasataView>('/rider/basata'),
    getTranslations('riderBasata'),
  ]);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">
        <Link href="/rider" className="text-body-sm font-semibold text-link">
          {t('backHome')}
        </Link>
        <h1 className="mb-4 mt-2 text-h2">{t('title')}</h1>
        <RiderBasata view={view} />
      </main>
    </div>
  );
}

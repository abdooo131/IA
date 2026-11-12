import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/Logo';

export const dynamic = 'force-dynamic';

const ERRORS = [
  'shop_not_linked',
  'expired',
  'invalid_request',
  'install_failed',
  'invalid_shop',
  'not_configured',
];

/** Where Shopify sends a merchant after installing (or failing to install) the app. */
export default async function ShopifyInstalledPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string; error?: string }>;
}) {
  const { shop = '', error } = await searchParams;
  const t = await getTranslations('shopifyInstalled');
  const failed = error !== undefined;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo alt={t('title')} />
      <div
        role={failed ? 'alert' : 'status'}
        className={`w-full rounded-lg border bg-surface p-6 shadow-sm ${failed ? 'border-danger' : 'border-line'}`}
      >
        {failed ? (
          <p className="text-body">
            {t(`errors.${ERRORS.includes(error) ? error : 'install_failed'}`, { shop })}
          </p>
        ) : (
          <>
            <p className="text-body font-bold">{t('ok', { shop })}</p>
            <p className="mt-2 text-body-sm text-text-muted">{t('next')}</p>
          </>
        )}
      </div>
    </main>
  );
}

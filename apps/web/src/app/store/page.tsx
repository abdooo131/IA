import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { StoreRef } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

/** Staff go straight to their store; admins choose one. */
export default async function StorePickerPage() {
  const [stores, t, locale] = await Promise.all([
    apiGet<StoreRef[]>('/stores'),
    getTranslations('store'),
    getLocale(),
  ]);
  if (stores.length === 1) redirect(`/store/${stores[0]!.id}`);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        {stores.length === 0 ? (
          <p className="text-body">{t('noStore')}</p>
        ) : (
          <>
            <h1 className="text-h2">{t('chooseStore')}</h1>
            <ul className="mt-4 space-y-2">
              {stores.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/store/${s.id}`}
                    className="block rounded-lg border border-line bg-surface p-4 text-h3 shadow-sm"
                  >
                    {localized(s, locale)}{' '}
                    <span className="ltr-iso text-body-sm text-text-muted">{s.code}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

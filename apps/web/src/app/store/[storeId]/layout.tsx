import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { BottomTabs } from '@/components/BottomTabs';

export default async function StoreLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const [t, tc, common] = await Promise.all([
    getTranslations('store.home'),
    getTranslations('storeCash'),
    getTranslations('common'),
  ]);
  const base = `/store/${storeId}`;
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-5">{children}</main>
      <BottomTabs
        label={common('menu')}
        tabs={[
          { href: base, label: t('homeTab'), icon: 'home', exact: true },
          { href: `${base}/orders`, label: t('orders'), icon: 'orders' },
          { href: `${base}/receive`, label: t('receive'), icon: 'pickups' },
          { href: `${base}/cash`, label: tc('tab'), icon: 'cash' },
        ]}
      />
    </div>
  );
}

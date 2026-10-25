import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { MerchantNav } from '@/components/merchant/MerchantNav';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const me = await apiGet<{ merchant: { name: string }; unreadNotifications: number }>(
    '/merchant/me',
  );
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <MerchantNav unread={me.unreadNotifications} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <p className="text-caption text-text-muted">{me.merchant.name}</p>
        {children}
      </main>
    </div>
  );
}

import type { MyPush } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { PushSettings } from '@/components/PushSettings';
import { homeFor } from '@/lib/access';
import { apiGet } from '@/lib/api-server';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** Phone and computer notifications: this device, the kinds of notification, every device. */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/notifications');
  const [push, t] = await Promise.all([apiGet<MyPush>('/me/push'), getTranslations('push')]);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link href={homeFor(user.role) ?? '/'} className="text-body-sm text-link">
          {t('back')}
        </Link>
        <h1 className="mt-2 text-h2">{t('title')}</h1>
        <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
        <PushSettings initial={push} />
      </main>
    </div>
  );
}

import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { homeFor, safeNext } from '@/lib/access';
import { getCurrentUser, getTheme } from '@/lib/server-session';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  // Ask the API rather than trusting the local token check, so a session the API rejects
  // (deactivated user, API down) shows the form instead of bouncing back to an area.
  const user = await getCurrentUser();
  if (user) redirect(next ?? homeFor(user.role) ?? '/');

  const t = await getTranslations();

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="flex justify-end px-4 py-3">
        <PreferencesMenu theme={await getTheme()} />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-6 sm:items-center">
        <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-md">
          <Logo alt={t('common.appName')} />
          <h1 className="mt-6 text-h3">{t('login.title')}</h1>
          <p className="mt-1 text-body-sm text-text-muted">{t('login.subtitle')}</p>
          <LoginForm next={next} />
          <p className="mt-6 text-center text-body-sm text-text-muted">
            {t('login.newMerchant')}{' '}
            <Link href="/signup" className="font-bold text-link underline">
              {t('login.applyLink')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

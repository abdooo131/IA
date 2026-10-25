import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { homeFor } from '@/lib/access';
import { getClaims } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const claims = await getClaims();
  if (!claims) redirect('/login');
  const home = homeFor(claims.role);
  if (home) redirect(home);

  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-start justify-center gap-4 px-4">
      <Logo alt={t('common.appName')} />
      <p className="text-body">{t('home.noArea')}</p>
      <SignOutButton />
    </main>
  );
}

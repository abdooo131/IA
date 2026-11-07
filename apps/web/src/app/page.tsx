import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { REFRESH_TOKEN_COOKIE } from '@shiplynow/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { SiteHome } from '@/components/site/SiteHome';
import { siteMetadata } from '@/components/site/metadata';
import { homeFor } from '@/lib/access';
import { getClaims } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** The public website's title, description and Open Graph card, in the visitor's language. */
export function generateMetadata(): Promise<Metadata> {
  return siteMetadata('home');
}

/**
 * Signed out visitors get the public website; a signed in person goes to their own area, as
 * before the website existed.
 */
export default async function HomePage() {
  const claims = await getClaims();
  if (!claims) {
    // An expired sign in still has its refresh token: renew it and come back to the person's area.
    if ((await cookies()).has(REFRESH_TOKEN_COOKIE)) redirect('/auth/refresh?next=%2F');
    return <SiteHome />;
  }
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

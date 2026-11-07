import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { SiteHome } from '@/components/site/SiteHome';
import { homeFor } from '@/lib/access';
import { getClaims } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** The public website's title, description and Open Graph card, in the visitor's language. */
export async function generateMetadata(): Promise<Metadata> {
  const [site, locale] = await Promise.all([getTranslations('site'), getLocale()]);
  const t = (key: 'title' | 'description' | 'ogAlt') => site(`meta.${key}`);
  return {
    title: { absolute: t('title') },
    description: t('description'),
    metadataBase: siteOrigin(),
    openGraph: {
      type: 'website',
      siteName: site('brand'),
      title: t('title'),
      description: t('description'),
      locale: locale === 'ar' ? 'ar_EG' : 'en_EG',
      alternateLocale: locale === 'ar' ? 'en_EG' : 'ar_EG',
      url: '/',
      images: [{ url: '/brand/app-icon-512.png', width: 512, height: 512, alt: t('ogAlt') }],
    },
    twitter: { card: 'summary', title: t('title'), description: t('description') },
  };
}

/** The address Open Graph links start from (WEB_ORIGIN), when it is set and valid. */
function siteOrigin(): URL | null {
  try {
    return process.env.WEB_ORIGIN ? new URL(process.env.WEB_ORIGIN) : null;
  } catch {
    return null;
  }
}

/**
 * Signed out visitors get the public website; a signed in person goes to their own area, as
 * before the website existed.
 */
export default async function HomePage() {
  const claims = await getClaims();
  if (!claims) return <SiteHome />;
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

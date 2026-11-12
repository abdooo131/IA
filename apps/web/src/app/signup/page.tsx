import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BrandPanel } from '@/components/BrandPanel';
import { Logo } from '@/components/Logo';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { getTheme } from '@/lib/server-session';
import { SignUpForm } from './SignUpForm';

export const dynamic = 'force-dynamic';

/** Public: a merchant applies for Shiply Now; admin approves before the first sign in. */
export default async function SignUpPage() {
  const t = await getTranslations();
  return (
    <BrandPanel top={<PreferencesMenu theme={await getTheme()} />}>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-6">
        <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-md sm:p-8">
          <Logo alt={t('common.appName')} size="lg" />
          <h1 className="mt-6 text-h3">{t('signup.title')}</h1>
          <p className="mt-1 text-body-sm text-text-muted">{t('signup.subtitle')}</p>
          <SignUpForm />
          <p className="mt-6 text-center text-body-sm text-text-muted">
            {t('signup.haveAccount')}{' '}
            <Link href="/login" className="font-bold text-link underline">
              {t('signup.signIn')}
            </Link>
          </p>
        </div>
      </main>
    </BrandPanel>
  );
}

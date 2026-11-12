'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALE_COOKIE } from '@/lib/preferences';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Switches the site between English and Arabic with the app's locale cookie (the same one the
 * settings menu sets), then renders the page again on the server in the other language.
 */
export function LanguageSwitch() {
  const t = useTranslations('site.nav');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const other = locale === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      className="s-lang"
      lang={other}
      aria-label={`${t('language')}: ${t('otherLanguage')}`}
      disabled={pending}
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
        startTransition(() => router.refresh());
      }}
    >
      {t('otherLanguage')}
    </button>
  );
}

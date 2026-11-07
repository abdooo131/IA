'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { setPreference, useLocale } from '@/lib/i18n';

/** Public tracking frame: logo, language switch, page content. No sign in. */
export function TrackFrame({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-between px-4">
          <Link href="/track" aria-label="Shiply">
            <Logo />
          </Link>
          <button
            type="button"
            onClick={() => setPreference('shiply_locale', locale === 'ar' ? 'en' : 'ar')}
            className="btn-secondary min-h-9 px-3 text-caption"
            lang={locale === 'ar' ? 'en' : 'ar'}
          >
            {locale === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
    </div>
  );
}

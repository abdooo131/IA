'use client';

import { useEffect, useState } from 'react';
import { directionOf, LOCALE_COOKIE, type Locale, toLocale } from '@/lib/preferences';
import '@/styles/globals.css';

/**
 * Shown when the root layout itself fails, so the translations provider is not there. Its few
 * words live here in both languages; this is the only screen allowed to keep its own table.
 */
const WORDS: Record<Locale, { title: string; body: string; retry: string; home: string }> = {
  en: {
    title: 'Something went wrong',
    body: 'This page could not be shown. Try again, or go back to the home page.',
    retry: 'Try again',
    home: 'Go to the home page',
  },
  ar: {
    title: 'حصلت مشكلة',
    body: 'الصفحة دي ما ظهرتش. جرب تاني، أو ارجع للصفحة الرئيسية.',
    retry: 'جرب تاني',
    home: 'روح للصفحة الرئيسية',
  },
};

function cookieLocale(): Locale {
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  return toLocale(match?.slice(LOCALE_COOKIE.length + 1));
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    setLocale(cookieLocale());
    console.error(error);
  }, [error]);
  const w = WORDS[locale];

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body className="min-h-dvh bg-bg text-text">
        <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
          <h1 className="text-h2">{w.title}</h1>
          <p className="mt-2 text-body text-text-muted">{w.body}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex h-11 items-center rounded-md bg-primary px-5 font-bold text-on-primary"
            >
              {w.retry}
            </button>
            {/* A plain link: the app's router may be what failed. */}
            <a
              href="/"
              className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-5 font-bold text-text"
            >
              {w.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}

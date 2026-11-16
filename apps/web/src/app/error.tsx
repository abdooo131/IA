'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect } from 'react';

/** Shown when a page throws (an API that cannot be reached, a bug): try again or go home. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');
  const tn = useTranslations('notFound');
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-h2">{t('errorTitle')}</h1>
      <p className="mt-2 text-body text-text-muted">{t('errorBody')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex h-11 items-center rounded-md bg-primary px-5 font-bold text-on-primary"
        >
          {t('tryAgain')}
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-5 font-bold text-text"
        >
          {tn('home')}
        </Link>
      </div>
    </main>
  );
}

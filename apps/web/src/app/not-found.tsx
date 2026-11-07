import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/** Shown for a record that does not exist or is not this user's to see. */
export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-2 text-body text-text-muted">{t('body')}</p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-5 font-bold text-on-primary"
      >
        {t('home')}
      </Link>
    </main>
  );
}

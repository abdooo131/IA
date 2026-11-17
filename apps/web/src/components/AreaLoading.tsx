import { getTranslations } from 'next-intl/server';

/** What an area shows while its page loads from the API (each area's loading.tsx). */
export async function AreaLoading() {
  const t = await getTranslations('common');
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[40dvh] items-center justify-center"
    >
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-4 border-line border-t-primary"
      />
      <span className="sr-only">{t('loading')}</span>
    </div>
  );
}

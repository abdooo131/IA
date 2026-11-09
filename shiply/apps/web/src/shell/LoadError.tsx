'use client';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';

/** What a page shows when its data could not be loaded: not found, or try again. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations('common');
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="page empty" data-testid="load-error">
      <p>{notFound ? t('notFound') : t('loadFailed')}</p>
      {!notFound && onRetry && (
        <button className="btn primary" onClick={onRetry}>
          {t('tryAgain')}
        </button>
      )}
    </div>
  );
}

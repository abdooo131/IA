'use client';
import { useTranslations } from 'next-intl';
import type { AppId } from '@shiply/shared';
import { Link } from '@/i18n/routing';

export function NoAccess({ app }: { app: AppId }) {
  const t = useTranslations();
  return (
    <main className="page empty" data-testid="no-access">
      <h1>{t('noAccess.title')}</h1>
      <p>{t('noAccess.body', { app: t(`apps.${app}`) })}</p>
      <Link href="/" className="btn primary">
        {t('noAccess.home')}
      </Link>
    </main>
  );
}

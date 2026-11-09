'use client';
import { useTranslations } from 'next-intl';
import { notFound, useParams } from 'next/navigation';
import { isAppId } from '@shiply/shared';
import { AppShell } from '@/shell/AppShell';

/** Apps not built yet: the shell, access check and a short note. */
export default function AppPlaceholder() {
  const t = useTranslations('common');
  const { app } = useParams<{ app: string }>();
  if (!isAppId(app)) notFound();
  return (
    <AppShell app={app} menu={[]}>
      <p className="muted">{t('comingSoon')}</p>
    </AppShell>
  );
}

'use client';
import { useTranslations } from 'next-intl';
import { AppShell } from '@/shell/AppShell';
import { MERCHANTS_MENU } from '../menu';

export default function PackagingPage() {
  const t = useTranslations('merchants');
  return (
    <AppShell app="merchants" menu={MERCHANTS_MENU}>
      <h1>{t('packaging')}</h1>
      <p className="muted">{t('laterPurchasing')}</p>
    </AppShell>
  );
}

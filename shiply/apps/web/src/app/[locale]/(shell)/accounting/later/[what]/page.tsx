'use client';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { AppShell } from '@/shell/AppShell';
import { ACCOUNTING_MENU } from '../../menu';

export default function Later() {
  const t = useTranslations('accounting');
  const { what } = useParams<{ what: string }>();
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      <h1>{t.has(what) ? t(what) : what}</h1>
      <p className="muted">{t('phase2')}</p>
    </AppShell>
  );
}

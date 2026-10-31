import { getTranslations } from 'next-intl/server';
import { SettingsEditor } from '@/components/admin/SettingsEditor';
import { apiGet } from '@/lib/api-server';
import type { SettingsList } from '@/lib/dashboard-types';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const [settings, t] = await Promise.all([
    apiGet<SettingsList>('/admin/settings'),
    getTranslations('admin.settings'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('intro')}</p>
      <SettingsEditor initial={settings} />
    </>
  );
}

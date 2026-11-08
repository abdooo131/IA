import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SettingsEditor } from '@/components/admin/SettingsEditor';
import { apiGet } from '@/lib/api-server';
import { type SettingsAppId as AppId, SETTINGS_APPS } from '@/lib/apps';
import type { SettingsList } from '@/lib/dashboard-types';

export const dynamic = 'force-dynamic';

/** One app's settings (its Configuration menu), never the whole list at once. */
export default async function AppSettingsPage({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  if (!(SETTINGS_APPS as readonly string[]).includes(app)) notFound();
  const [settings, t, ta] = await Promise.all([
    apiGet<SettingsList>('/admin/settings'),
    getTranslations('admin.settings'),
    getTranslations('apps'),
  ]);
  return (
    <>
      <h1 className="text-h2">{ta('settingsTitle', { app: ta(`names.${app}`) })}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('intro')}</p>
      <SettingsEditor initial={settings} app={app as AppId} />
    </>
  );
}

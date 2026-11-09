'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { RecordPage, type TimelineEntry } from '@/shell/RecordPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SETTINGS_MENU } from '../../menu';
import type { UserRow } from '../page';

interface AuditRow {
  at: string;
  action: string;
  userId: string | null;
}

export default function UserPage() {
  const t = useTranslations();
  const locale = useLocale();
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<UserRow | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const load = useCallback(async () => {
    setUser(await api<UserRow>(`/users/${id}`));
    const log = await api<{ rows: AuditRow[] }>(`/audit?entity=user&entityId=${id}`);
    setTimeline(log.rows.map((r) => ({ at: r.at, text: t.has(`settings.actions.${r.action.replace(/\./g, '_')}`) ? t(`settings.actions.${r.action.replace(/\./g, '_')}`) : r.action })));
  }, [id, t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!user) return <AppShell app="settings" menu={SETTINGS_MENU}>{null}</AppShell>;
  const ar = locale === 'ar';
  const toggle = async () => {
    const label = user.active ? t('settings.deactivate') : t('settings.activate');
    if (!(await confirm({ title: label, body: ar ? user.nameAr : user.name, danger: user.active }))) return;
    await api(`/users/${id}`, { method: 'PATCH', json: { active: !user.active } });
    toast.success(t('common.saved'));
    await load();
  };
  return (
    <AppShell app="settings" menu={SETTINGS_MENU}>
      <RecordPage
        back={<Link href="/settings/users">‹ {t('settings.users')}</Link>}
        number={ar ? user.nameAr : user.name}
        status={<span className={`pill${user.active ? ' on' : ''}`}>{user.active ? t('settings.active') : t('settings.inactive')}</span>}
        actions={
          atLeast(me.access.settings, 'manage') ? (
            <button className={`btn ${user.active ? 'danger' : 'primary'}`} onClick={() => void toggle()}>
              {user.active ? t('settings.deactivate') : t('settings.activate')}
            </button>
          ) : undefined
        }
        tabs={[
          {
            key: 'details',
            label: t('settings.details'),
            content: (
              <dl className="fields">
                <dt>{t('settings.name')}</dt>
                <dd>{user.name}</dd>
                <dt>{t('settings.nameAr')}</dt>
                <dd>{user.nameAr}</dd>
                <dt>{t('settings.email')}</dt>
                <dd>{user.email ?? ''}</dd>
                <dt>{t('settings.mobile')}</dt>
                <dd dir="ltr">{user.mobile ?? ''}</dd>
                <dt>{t('settings.role')}</dt>
                <dd>{ar ? user.role.nameAr : user.role.nameEn}</dd>
              </dl>
            ),
          },
        ]}
        timeline={timeline}
      />
    </AppShell>
  );
}

'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SETTINGS_MENU } from '../menu';

interface Row {
  eventId: string;
  handler: string;
  attempts: number;
  lastError: string | null;
  event: { type: string; at: string };
}

export default function DeadLettersPage() {
  const t = useTranslations();
  const me = useMe();
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => setRows((await api<{ rows: Row[] }>('/events/dead')).rows), []);
  useEffect(() => {
    void load();
  }, [load]);
  const retry = async (r: Row) => {
    if (!(await confirm({ title: t('settings.retry'), body: t('settings.retryBody') }))) return;
    await api(`/events/dead/${r.eventId}/${encodeURIComponent(r.handler)}/retry`, { method: 'POST' });
    toast.success(t('common.saved'));
    await load();
  };
  const list = (rows ?? []).map((r) => ({ ...r, id: `${r.eventId}:${r.handler}` }));
  return (
    <AppShell app="settings" menu={SETTINGS_MENU}>
      <ListPage
        title={t('settings.dead')}
        columns={[
          { key: 'type', label: t('settings.event'), render: (r) => r.event.type },
          { key: 'handler', label: t('settings.handler') },
          { key: 'attempts', label: t('settings.attempts') },
          { key: 'lastError', label: t('settings.error'), render: (r) => r.lastError ?? '' },
          { key: 'at', label: t('settings.when'), render: (r) => new Date(r.event.at).toLocaleString() },
          {
            key: 'retry',
            label: '',
            render: (r) =>
              atLeast(me.access.settings, 'manage') ? (
                <button className="btn ghost" onClick={() => void retry(r)}>
                  {t('settings.retry')}
                </button>
              ) : null,
          },
        ]}
        rows={list}
        total={list.length}
        page={1}
        pageSize={200}
        onPage={() => undefined}
        loading={!rows}
      />
    </AppShell>
  );
}

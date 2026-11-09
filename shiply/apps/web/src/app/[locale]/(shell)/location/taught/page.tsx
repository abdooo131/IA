'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { LOCATION_MENU } from '../menu';

interface Taught {
  id: string;
  name: string;
  placeId: string;
  byUserId: string | null;
  at: string;
}

export default function TaughtPage() {
  const t = useTranslations('location');
  const tc = useTranslations('common');
  const me = useMe();
  const [rows, setRows] = useState<Taught[] | null>(null);
  const load = useCallback(() => api<Taught[]>('/location/taught').then(setRows, () => toast.error(tc('failed'))), [tc]);
  useEffect(() => {
    void load();
  }, [load]);
  const remove = async (x: Taught) => {
    if (!(await confirm({ title: t('remove'), body: x.name, danger: true }))) return;
    try {
      await api(`/location/taught/${x.id}`, { method: 'DELETE' });
      await load();
    } catch {
      toast.error(tc('failed'));
    }
  };
  return (
    <AppShell app="location" menu={LOCATION_MENU}>
      <ListPage<Taught>
        title={t('taught')}
        columns={[
          { key: 'name', label: t('name'), render: (r) => <span dir="auto">{r.name}</span> },
          { key: 'placeId', label: t('area') },
          { key: 'at', label: t('when'), render: (r) => new Date(r.at).toLocaleString() },
          {
            key: 'remove',
            label: '',
            render: (r) =>
              atLeast(me.access.location, 'manage') ? (
                <button className="btn ghost" onClick={() => void remove(r)}>
                  {t('remove')}
                </button>
              ) : null,
          },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!rows}
      />
    </AppShell>
  );
}

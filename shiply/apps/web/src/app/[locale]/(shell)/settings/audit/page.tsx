'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { SETTINGS_MENU } from '../menu';

interface Row {
  id: string;
  at: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
}

export default function AuditPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);
  useEffect(() => {
    api<{ rows: Row[]; total: number }>(`/audit?page=${page}`).then(setData, () => toast.error(tc('failed')));
  }, [page, tc]);
  // Action codes hold dots (user.created); message keys use underscores.
  const known = (group: string, key: string) => {
    const k = `${group}.${key.replace(/\./g, '_')}`;
    return t.has(k) ? t(k) : key;
  };
  return (
    <AppShell app="settings" menu={SETTINGS_MENU}>
      <ListPage<Row>
        title={t('audit')}
        columns={[
          { key: 'at', label: t('when'), render: (r) => new Date(r.at).toLocaleString() },
          { key: 'action', label: t('action'), render: (r) => known('actions', r.action) },
          { key: 'entity', label: t('record'), render: (r) => known('entities', r.entity) },
          { key: 'userId', label: t('who'), render: (r) => r.userId ?? '' },
        ]}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        loading={!data}
      />
    </AppShell>
  );
}

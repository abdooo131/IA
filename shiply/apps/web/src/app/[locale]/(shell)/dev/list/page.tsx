'use client';
// A demo of the list page and app menu patterns, used by the end to end tests.
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AppShell, type MenuItem } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';

const ROWS = Array.from({ length: 120 }, (_, i) => ({ id: `D${i + 1}`, name: `Item ${i + 1}`, status: i % 3 ? 'open' : 'done' }));
const MENU: MenuItem[] = ['users', 'audit', 'dead', 'newUser', 'name', 'email', 'mobile', 'role', 'password'].map((k) => ({
  label: `settings.${k}`,
  href: '/dev/list',
}));

export default function DemoList() {
  const t = useTranslations('demo');
  const [page, setPage] = useState(1);
  return (
    <AppShell app="settings" menu={MENU}>
      <ListPage
        title={t('title')}
        action={<button className="btn primary">{t('action')}</button>}
        columns={[
          { key: 'id', label: t('number') },
          { key: 'name', label: t('name') },
          { key: 'status', label: t('status') },
        ]}
        rows={ROWS.slice((page - 1) * 50, page * 50)}
        total={ROWS.length}
        page={page}
        onPage={setPage}
        bulkActions={[{ label: t('delete'), danger: true, confirmBody: t('deleteBody'), run: (ids) => void toast.success(String(ids.length)) }]}
      />
    </AppShell>
  );
}

'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { useMe } from '@/shell/me';
import { toast } from '@/shell/feedback';
import { SETTINGS_MENU } from '../menu';

export interface UserRow {
  id: string;
  name: string;
  nameAr: string;
  email: string | null;
  mobile: string | null;
  active: boolean;
  createdAt: string;
  role: { key: string; nameEn: string; nameAr: string };
}

export default function UsersPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const me = useMe();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ rows: UserRow[]; total: number } | null>(null);
  useEffect(() => {
    api<{ rows: UserRow[]; total: number }>(`/users?page=${page}&q=${encodeURIComponent(q)}`).then(setData, () => toast.error(tc('failed')));
  }, [page, q, tc]);
  const ar = locale === 'ar';
  return (
    <AppShell app="settings" menu={SETTINGS_MENU}>
      <ListPage<UserRow>
        title={t('users')}
        action={
          atLeast(me.access.settings, 'manage') ? (
            <Link href="/settings/users/new" className="btn primary">
              {t('newUser')}
            </Link>
          ) : undefined
        }
        filters={<input type="search" value={q} onChange={(e) => (setPage(1), setQ(e.target.value))} placeholder={t('searchUsers')} aria-label={t('searchUsers')} />}
        columns={[
          { key: 'name', label: t('name'), render: (r) => (ar ? r.nameAr : r.name) },
          { key: 'email', label: t('email'), render: (r) => r.email ?? '' },
          { key: 'mobile', label: t('mobile'), render: (r) => <span dir="ltr">{r.mobile ?? ''}</span> },
          { key: 'role', label: t('role'), render: (r) => (ar ? r.role.nameAr : r.role.nameEn) },
          { key: 'active', label: t('status'), render: (r) => <span className={`pill${r.active ? ' on' : ''}`}>{r.active ? t('active') : t('inactive')}</span> },
        ]}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        loading={!data}
        onRowClick={(r) => router.push(`/settings/users/${r.id}`)}
      />
    </AppShell>
  );
}

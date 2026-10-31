import { getTranslations } from 'next-intl/server';
import { type AdminUser, UsersManager } from '@/components/admin/UsersManager';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { getClaims } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'finance', 'store_staff', 'rider', 'merchant'] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; q?: string }>;
}) {
  const filters = await searchParams;
  const query = new URLSearchParams();
  if (filters.role) query.set('role', filters.role);
  if (filters.q) query.set('q', filters.q);
  const [users, stores, merchants, claims, t, roles] = await Promise.all([
    apiGet<AdminUser[]>(`/admin/users?${query}`),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<{ id: string; name: string }[]>('/admin/merchants'),
    getClaims(),
    getTranslations('admin.users'),
    getTranslations('roles'),
  ]);
  const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <select
          name="role"
          defaultValue={filters.role ?? ''}
          className={field}
          aria-label={t('role')}
        >
          <option value="">{t('allRoles')}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roles(r)}
            </option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder={t('search')}
          className={`${field} w-56`}
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('apply')}
        </button>
      </form>
      <UsersManager
        key={query.toString()}
        users={users}
        stores={stores.map((s) => ({ id: s.id, nameEn: s.nameEn, nameAr: s.nameAr }))}
        merchants={merchants}
        meId={claims?.sub ?? null}
      />
    </>
  );
}

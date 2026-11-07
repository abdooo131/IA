import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { DamageList } from '@/components/damage/DamageList';
import { apiGet } from '@/lib/api-server';
import type { DamageReportRow } from '@/lib/damage-types';

export const dynamic = 'force-dynamic';

export default async function AdminDamagePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const status = (await searchParams).status === 'settled' ? 'settled' : 'pending';
  const [rows, t] = await Promise.all([
    apiGet<DamageReportRow[]>(`/admin/damage?status=${status}`),
    getTranslations('damage'),
  ]);
  const tab = (s: string) =>
    `rounded-md px-4 py-2 text-body-sm font-bold ${s === status ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
      <nav className="mt-4 flex gap-2">
        <Link href="/admin/damage" className={tab('pending')}>
          {t('statuses.pending')}
        </Link>
        <Link href="/admin/damage?status=settled" className={tab('settled')}>
          {t('statuses.settled')}
        </Link>
      </nav>
      <DamageList rows={rows} canSettle />
    </>
  );
}

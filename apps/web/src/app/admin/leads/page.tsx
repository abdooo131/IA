import { canDo, SITE_LEAD_STATUSES, type SiteLeadStatus } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { type SiteLeadRow, SiteLeadsList } from '@/components/admin/SiteLeadsList';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/** Merchants app: leads from the public website's contact form (merchants view; use to edit). */
export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const asked = (await searchParams).status;
  const status = (SITE_LEAD_STATUSES as readonly string[]).includes(asked ?? '')
    ? (asked as SiteLeadStatus)
    : null;
  const [leads, profile, t] = await Promise.all([
    apiGet<SiteLeadRow[]>(`/admin/site-leads${status ? `?status=${status}` : ''}`),
    getMyProfile(),
    getTranslations('admin.leads'),
  ]);
  const tab = (s: SiteLeadStatus | null) =>
    `rounded-md px-4 py-2 text-body-sm font-bold ${s === status ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
      <nav className="mt-4 flex flex-wrap gap-2">
        <Link href="/admin/leads" className={tab(null)}>
          {t('all')}
        </Link>
        {SITE_LEAD_STATUSES.map((s) => (
          <Link key={s} href={`/admin/leads?status=${s}`} className={tab(s)}>
            {t(`statuses.${s}`)}
          </Link>
        ))}
      </nav>
      <SiteLeadsList leads={leads} canEdit={canDo(profile, 'merchants', 'use')} />
    </>
  );
}

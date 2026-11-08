import { AlertsList } from '@/components/alerts/AlertsList';

export const dynamic = 'force-dynamic';

/** Operations' alerts: both companies, with a company filter. */
export default async function AdminAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string; company?: string }>;
}) {
  const { all, company } = await searchParams;
  return (
    <AlertsList
      basePath="/admin/alerts"
      all={all}
      company={company === 'shiply_now' || company === 'shiply' ? company : undefined}
      companyFilter
    />
  );
}

import { AlertsList } from '@/components/alerts/AlertsList';

export const dynamic = 'force-dynamic';

/** Shiply's Alerts menu: the one alerts list, filtered to Shiply (docs/MERGE.md step 6). */
export default async function ShiplyAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  return (
    <AlertsList basePath="/parcels/admin/alerts" all={all} company="shiply" companyFilter={false} />
  );
}

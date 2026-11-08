import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import { merchantNav } from '@/lib/merchant-nav';
import { Session } from '@/parcels/components/Shell';

export const dynamic = 'force-dynamic';

/**
 * Next day parcels inside the one merchant portal: the same menu and frame as /merchant
 * (lib/merchant-nav.ts). Session gives the network's pages the signed in merchant.
 */
export default async function ParcelsMerchantLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardShell groups={await merchantNav()}>
      <Session roles={['MERCHANT']}>{children}</Session>
    </DashboardShell>
  );
}

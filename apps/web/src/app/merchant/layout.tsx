import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import { merchantNav } from '@/lib/merchant-nav';

export const dynamic = 'force-dynamic';

/** The merchant portal: one menu for both services (lib/merchant-nav.ts). */
export default async function MerchantLayout({ children }: { children: ReactNode }) {
  return <DashboardShell groups={await merchantNav()}>{children}</DashboardShell>;
}

import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiTry } from '@/lib/api-server';
import { Session } from '@/parcels/components/Shell';

interface Inbox {
  withdrawals: number;
  payIns: number;
  deposits: number;
  settlements: number;
  advances: number;
}

/**
 * Shiply, the parcel network, is one of the apps: the same top bar and menus as every other
 * app (lib/apps.ts), and its money screens sit in Accounting. Session gives the network's
 * pages the signed in person. Counts are 0 when the person may not open a list.
 */
export default async function ShiplyAdminLayout({ children }: { children: ReactNode }) {
  const [alerts, signups, inbox] = await Promise.all([
    apiTry<unknown[]>('/parcels/admin/alerts'),
    apiTry<unknown[]>('/parcels/admin/signups'),
    apiTry<Inbox>('/parcels/finance/inbox'),
  ]);
  return (
    <AppShell
      badges={{
        '/parcels/admin/alerts': alerts?.length ?? 0,
        '/parcels/admin/signups': signups?.length ?? 0,
        '/parcels/admin/money/couriers': (inbox?.payIns ?? 0) + (inbox?.withdrawals ?? 0),
        '/parcels/admin/money/safes': inbox?.deposits ?? 0,
        '/parcels/admin/money/agents': inbox?.settlements ?? 0,
        '/parcels/admin/money/advances': inbox?.advances ?? 0,
      }}
    >
      <Session roles={['ADMIN']}>{children}</Session>
    </AppShell>
  );
}

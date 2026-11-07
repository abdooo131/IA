'use client';
import { Suspense } from 'react';
import { HubProvider } from '@/components/HubContext';
import { AppShell, type Me } from '@/components/Shell';

/**
 * The Hub floor app. A sorting facility has three stations, one per team: a team member sees
 * only their station; supervisors and admins see every station, pickups, runs and the safe.
 * A last mile hub has no teams.
 */
const ROLES: Me['role'][] = ['ADMIN', 'HUB_STAFF'];

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell roles={ROLES}>
      <Suspense>
        <HubProvider>{children}</HubProvider>
      </Suspense>
    </AppShell>
  );
}

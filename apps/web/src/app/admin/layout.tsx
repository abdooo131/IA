import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiTry } from '@/lib/api-server';

/**
 * Admin pages belong to the Operations, Inventory, Merchants, Customers, HR, Sales and Settings
 * apps. The HR menus count what waits in the person's inbox and the suggested violations
 * (0 for people with nothing waiting; never an error page when the count fails).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const hr = await apiTry<{ inbox: number; suggested: number }>('/me/hr-badges');
  return (
    <AppShell
      badges={{
        '/admin/hr/inbox': hr?.inbox ?? 0,
        '/admin/hr/violations/suggested': hr?.suggested ?? 0,
      }}
    >
      {children}
    </AppShell>
  );
}

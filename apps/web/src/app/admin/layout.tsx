import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';

/** Admin pages belong to the Operations, Inventory, Merchants, Customers and Settings apps. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { AdminNav } from '@/components/admin/AdminNav';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

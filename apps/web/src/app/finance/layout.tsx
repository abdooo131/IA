import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { FinanceNav } from '@/components/finance/FinanceNav';

export const dynamic = 'force-dynamic';

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <FinanceNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

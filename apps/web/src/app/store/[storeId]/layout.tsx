import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}

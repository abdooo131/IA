'use client';

import { AppProvider, LoginScreen, Shell, Spinner, useApp } from '@shiply/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

function Gate({ children }: { children: ReactNode }) {
  const { session, ready, t } = useApp();
  const pathname = usePathname();
  if (!ready) return <Spinner />;
  if (!session) return <LoginScreen title={t.appOps} hint={<>Demo: ops@shiply.eg / Shiply@2026</>} />;
  const nav = [
    { href: '/orders', label: t.orders },
    { href: '/admin/config', label: t.systemConfig },
    { href: '/admin/pricing', label: t.pricing },
    { href: '/admin/audit', label: t.auditLog },
  ];
  return (
    <Shell brand={t.appOps} nav={nav} pathname={pathname} Link={Link}>
      {children}
    </Shell>
  );
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <AppProvider app="ops">
      <Gate>{children}</Gate>
    </AppProvider>
  );
}

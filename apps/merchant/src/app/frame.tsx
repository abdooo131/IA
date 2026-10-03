'use client';

import { AppProvider, LoginScreen, Shell, Spinner, useApp } from '@shiply/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

function Gate({ children }: { children: ReactNode }) {
  const { session, ready, t } = useApp();
  const pathname = usePathname();
  if (!ready) return <Spinner />;
  if (!session) {
    return <LoginScreen title={t.appMerchant} hint={<>Demo: owner@evechantelle.com / Shiply@2026</>} />;
  }
  const nav = [
    { href: '/', label: t.dashboard },
    { href: '/orders', label: t.orders },
    { href: '/orders/new', label: t.newOrder },
    { href: '/orders/import', label: t.importCsv },
    { href: '/settings', label: t.settings },
  ];
  return (
    <Shell brand={t.appMerchant} nav={nav} pathname={pathname} Link={Link}>
      {children}
    </Shell>
  );
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <AppProvider app="merchant">
      <Gate>{children}</Gate>
    </AppProvider>
  );
}

'use client';

import { AppProvider, PdfViewerProvider, IconBox, IconDashboard, IconPlus, IconSettings, IconUpload, IconWallet, LoginScreen, Shell, Spinner, useApp } from '@shiply/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

function Gate({ children }: { children: ReactNode }) {
  const { session, ready, t } = useApp();
  const pathname = usePathname();
  if (!ready) return <Spinner />;
  if (!session) {
    return <LoginScreen title={t.merchantPortal} hint={<>Demo account: <span dir="ltr" className="font-mono">owner@evechantelle.com</span> · <span className="font-mono">Shiply@2026</span></>} />;
  }
  const nav = [
    { href: '/', label: t.dashboard, icon: IconDashboard },
    { href: '/orders', label: t.orders, icon: IconBox },
    { href: '/orders/new', label: t.newOrder, icon: IconPlus },
    { href: '/orders/import', label: t.importCsv, icon: IconUpload },
    { href: '/wallet', label: t.wallet, icon: IconWallet },
    { href: '/settings', label: t.settings, icon: IconSettings },
  ];
  return (
    <Shell brand={t.merchantPortal} nav={nav} pathname={pathname} Link={Link}>
      {children}
    </Shell>
  );
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <AppProvider app="merchant">
      <PdfViewerProvider>
        <Gate>{children}</Gate>
      </PdfViewerProvider>
    </AppProvider>
  );
}

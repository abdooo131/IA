'use client';

import { AppProvider, IconBox, IconHistory, IconSliders, IconTag, LoginScreen, Shell, Spinner, useApp } from '@shiply/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

function Gate({ children }: { children: ReactNode }) {
  const { session, ready, t } = useApp();
  const pathname = usePathname();
  if (!ready) return <Spinner />;
  if (!session) return <LoginScreen title={t.opsPortal} hint={<>Demo account: <span dir="ltr" className="font-mono">ops@shiply.eg</span> · <span className="font-mono">Shiply@2026</span></>} />;
  const nav = [
    { href: '/orders', label: t.orders, icon: IconBox },
    { href: '/admin/config', label: t.systemConfig, icon: IconSliders },
    { href: '/admin/pricing', label: t.pricing, icon: IconTag },
    { href: '/admin/audit', label: t.auditLog, icon: IconHistory },
  ];
  return (
    <Shell brand={t.opsPortal} nav={nav} pathname={pathname} Link={Link}>
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

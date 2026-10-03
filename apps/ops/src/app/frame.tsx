'use client';

import { AppProvider, PdfViewerProvider, IconAlert, IconBank, IconPickup, IconReturn, IconScan, IconTruck, IconUsers, IconBox, IconChart, IconHistory, IconLedger, IconSliders, IconTag, IconTransfer, IconWallet, LoginScreen, Shell, Spinner, useApp } from '@shiply/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

function Gate({ children }: { children: ReactNode }) {
  const { session, ready, t } = useApp();
  const pathname = usePathname();
  if (!ready) return <Spinner />;
  if (!session) return <LoginScreen title={t.opsPortal} hint={<>Demo account: <span dir="ltr" className="font-mono">ops@shiply.eg</span> · <span className="font-mono">Shiply@2026</span></>} />;
  const nav = [
    { href: '/orders', label: t.orders, icon: IconBox, group: t.operations },
    { href: '/operations/pickups', label: t.pickups, icon: IconPickup, group: t.operations },
    { href: '/operations/scan', label: t.hubScan, icon: IconScan, group: t.operations },
    { href: '/operations/transfers', label: t.transfers, icon: IconTransfer, group: t.operations },
    { href: '/operations/deliveries', label: t.deliveries, icon: IconTruck, group: t.operations },
    { href: '/operations/returns', label: t.returns, icon: IconReturn, group: t.operations },
    { href: '/operations/drivers', label: t.drivers, icon: IconUsers, group: t.operations },
    { href: '/operations/cash', label: t.driverCash, icon: IconWallet, group: t.operations },
    { href: '/operations/alerts', label: t.alerts, icon: IconAlert, group: t.operations },
    { href: '/finance', label: t.financeOverview, icon: IconBank, group: t.finance },
    { href: '/finance/cashouts', label: t.cashouts, icon: IconTransfer, group: t.finance },
    { href: '/finance/wallets', label: t.merchantWallets, icon: IconWallet, group: t.finance },
    { href: '/finance/deposits', label: t.deposits, icon: IconBank, group: t.finance },
    { href: '/finance/journal', label: t.journal, icon: IconLedger, group: t.finance },
    { href: '/finance/reports', label: t.reports, icon: IconChart, group: t.finance },
    { href: '/admin/config', label: t.systemConfig, icon: IconSliders, group: t.admin },
    { href: '/admin/pricing', label: t.pricing, icon: IconTag, group: t.admin },
    { href: '/admin/audit', label: t.auditLog, icon: IconHistory, group: t.admin },
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
      <PdfViewerProvider>
        <Gate>{children}</Gate>
      </PdfViewerProvider>
    </AppProvider>
  );
}

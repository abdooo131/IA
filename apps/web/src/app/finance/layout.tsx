import type { ReactNode } from 'react';
import { ClientMessages } from '@/components/ClientMessages';
import { AppShell } from '@/components/AppShell';
import { AccountingSearch } from '@/components/odoo/AccountingSearch';
import { apiGet } from '@/lib/api-server';
import type { FinanceControls } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** The Accounting app. */
export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const controls = await apiGet<FinanceControls>('/finance/controls');
  return (
    <ClientMessages scope="finance">
      <AppShell
        search={<AccountingSearch />}
        badges={{
          '/finance/approvals': controls.waiting + controls.payoutsToApprove,
          '/finance/receipts': controls.missingReceipts,
        }}
      >
        {children}
      </AppShell>
    </ClientMessages>
  );
}

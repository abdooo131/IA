'use client';
import { AppShell, type Me } from '@/parcels/components/Shell';
import { api } from '@/parcels/lib/api';

const ROLES: Me['role'][] = ['ADMIN'];

interface Inbox {
  payoutsYouCanApprove: number;
  payoutsToPay: number;
  withdrawals: number;
  payIns: number;
  deposits: number;
  settlements: number;
  expenses: number;
  journals: number;
  bills: number;
  creditNotes: number;
  advances: number;
  bankChanges: { mine: boolean }[];
}

/** Counts next to pages in the menus: what waits for someone, as Shiply Now's badges. */
async function badges(): Promise<Record<string, number>> {
  const [alerts, inbox, signups] = await Promise.all([api<unknown[]>('/admin/alerts').catch(() => []), api<Inbox>('/finance/inbox').catch(() => null), api<unknown[]>('/admin/signups').catch(() => [])]);
  return {
    '/admin/alerts': alerts.length,
    '/admin/signups': signups.length,
    ...(inbox
      ? {
          '/admin/money/payouts': inbox.payoutsYouCanApprove + inbox.payoutsToPay + inbox.bankChanges.filter((b) => !b.mine).length,
          '/admin/money/couriers': inbox.payIns + inbox.withdrawals,
          '/admin/money/safes': inbox.deposits,
          '/admin/money/agents': inbox.settlements,
          '/admin/money/expenses': inbox.expenses,
          '/admin/money/books': inbox.journals,
          '/admin/money/bills': inbox.bills,
          '/admin/money/invoices': inbox.creditNotes,
          '/admin/money/advances': inbox.advances,
        }
      : {}),
  };
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell roles={ROLES} badges={badges}>
      {children}
    </AppShell>
  );
}

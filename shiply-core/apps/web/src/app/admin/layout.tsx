'use client';
import { AppShell, type Me } from '@/components/Shell';
import { api } from '@/lib/api';

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
  bankChanges: { mine: boolean }[];
}

/** Counts next to pages in the menus: what waits for someone, as Shiply Now's badges. */
async function badges(): Promise<Record<string, number>> {
  const [alerts, inbox] = await Promise.all([api<unknown[]>('/admin/alerts').catch(() => []), api<Inbox>('/finance/inbox').catch(() => null)]);
  return {
    '/admin/alerts': alerts.length,
    ...(inbox
      ? {
          '/admin/money/payouts': inbox.payoutsYouCanApprove + inbox.payoutsToPay + inbox.bankChanges.filter((b) => !b.mine).length,
          '/admin/money/couriers': inbox.payIns + inbox.withdrawals,
          '/admin/money/safes': inbox.deposits,
          '/admin/money/agents': inbox.settlements,
          '/admin/money/expenses': inbox.expenses,
          '/admin/money/books': inbox.journals,
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

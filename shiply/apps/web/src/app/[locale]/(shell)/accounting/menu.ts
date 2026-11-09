import type { MenuItem } from '@/shell/AppShell';

/** Accounting menu (UI.md Step 3c); phase 2 pages say so. */
export const ACCOUNTING_MENU: MenuItem[] = [
  { label: 'accounting.cash', items: [{ label: 'accounting.holders', href: '/accounting/holders' }, { label: 'accounting.handovers', href: '/accounting/handovers' }] },
  { label: 'accounting.wallets', href: '/accounting/wallets' },
  { label: 'accounting.payouts', href: '/accounting/payouts' },
  { label: 'accounting.bills', href: '/accounting/bills' },
  { label: 'accounting.expenses', href: '/accounting/expenses' },
  {
    label: 'accounting.ledger',
    items: [
      { label: 'accounting.journal', href: '/accounting/journal' },
      { label: 'accounting.trial', href: '/accounting/trial-balance' },
      { label: 'accounting.pnl', href: '/accounting/profit-and-loss' },
    ],
  },
  { label: 'accounting.invoices', href: '/accounting/later/invoices' },
  { label: 'accounting.banks', href: '/accounting/later/banks' },
  { label: 'accounting.budgets', href: '/accounting/later/budgets' },
];

// Document pages (Odoo form views) and the one search of the Accounting app. A document page is
// described by the API as a DocDescriptor: its number, status, fields, lines, smart buttons
// (counts linking to related records) and the actions the reader may take; the web renders
// every kind with one DocumentPage. Notes, activities and history (the chatter) hang off the
// record's audit entity type.

/** The accounting documents with a document page. */
export const ACCOUNTING_DOCS = [
  'payout',
  'bill',
  'ledger_entry',
  'cheque',
  'rider_withdrawal',
  'finance_request',
  'petty_cash',
  'tax_invoice',
  'purchase_order',
  'cash_handover',
  'expense_claim',
] as const;
export type AccountingDoc = (typeof ACCOUNTING_DOCS)[number];

/** Document number prefixes the search understands, and the record kind each names. */
export const DOC_PREFIXES = {
  JV: 'ledger_entry',
  PAY: 'payout',
  CH: 'cash_handover',
  BILL: 'bill',
  INV: 'invoice',
  CN: 'credit_note',
  PO: 'purchase_order',
  CHQ: 'cheque',
  PC: 'petty_cash',
  RW: 'rider_withdrawal',
  BS: 'bank_statement',
  EC: 'expense_claim',
} as const;
export type DocPrefix = keyof typeof DOC_PREFIXES;

/**
 * Reads a typed document number: "PAY-000123", "pay-123", "pay 123" or "PAY123" all name
 * payout 123. Null when the text is not a document number.
 */
export function parseDocNumber(
  text: string,
): { prefix: DocPrefix; kind: (typeof DOC_PREFIXES)[DocPrefix]; number: number } | null {
  const m = /^\s*([a-z]{2,4})[\s\-#]*0*(\d{1,9})\s*$/i.exec(text);
  if (!m) return null;
  const prefix = m[1]!.toUpperCase() as DocPrefix;
  if (!(prefix in DOC_PREFIXES)) return null;
  const number = Number.parseInt(m[2]!, 10);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { prefix, kind: DOC_PREFIXES[prefix], number };
}

export type DocFieldKind =
  'text' | 'money' | 'date' | 'datetime' | 'ltr' | 'status' | 'percent' | 'multiline';

export interface DocField {
  /** Label key under documents.fields */
  key: string;
  value: string | number | null;
  kind: DocFieldKind;
  /** The value links to this page */
  href?: string;
}

export interface DocSmartButton {
  /** Label key under documents.smart */
  key: string;
  /** A count, or null when the button names one record */
  count: number | null;
  /** A short value shown instead of the count (a merchant's name) */
  value?: string;
  href: string;
}

export interface DocLineColumn {
  key: string;
  kind: DocFieldKind;
}

/** A document page's content; T is the document kind (the Accounting ones by default). */
export interface DocDescriptor<T extends string = AccountingDoc> {
  type: T;
  id: string;
  number: string;
  /** Who or what the document is about (a merchant, a supplier, a rider) */
  title: string;
  status: string;
  /** The status bar's path (lib/workflows.ts); null shows the status as a pill only */
  flow: string | null;
  /** The audit entity type: history, notes and activities hang off it */
  entityType: string;
  fields: DocField[];
  lines: { columns: DocLineColumn[]; rows: Record<string, string | number | null>[] } | null;
  smart: DocSmartButton[];
  attachments: { photoId: string; at: string; by: string | null }[];
  /** Actions the reader may take now (keys the page knows how to show) */
  actions: string[];
  /** Extra values an action needs (an amount, a merchant id) */
  data: Record<string, string | number | boolean | null>;
}

/** The list each document belongs to, for breadcrumbs and the list address. */
export const DOC_LISTS: Record<AccountingDoc, { list: string; href: string }> = {
  payout: { list: 'payouts', href: '/finance/payouts' },
  bill: { list: 'bills', href: '/finance/bills' },
  ledger_entry: { list: 'journal', href: '/finance/journal' },
  cheque: { list: 'cheques', href: '/finance/cheques' },
  rider_withdrawal: { list: 'riderWithdrawals', href: '/finance/rider-withdrawals' },
  finance_request: { list: 'approvals', href: '/finance/approvals' },
  petty_cash: { list: 'pettyCash', href: '/finance/petty-cash' },
  tax_invoice: { list: 'invoices', href: '/finance/invoices' },
  purchase_order: { list: 'purchaseOrders', href: '/finance/purchase-orders' },
  cash_handover: { list: 'storeCash', href: '/finance/cash' },
  expense_claim: { list: 'expenseClaims', href: '/finance/expense-claims' },
};

/** What the one search answers: a document, an order or a merchant, and where it opens. */
export interface SearchHit {
  kind: string;
  label: string;
  /** A second line (the merchant, an amount) */
  detail: string | null;
  href: string;
}

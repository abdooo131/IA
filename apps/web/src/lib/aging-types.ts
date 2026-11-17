import type { AgingBand, AgingBuckets } from '@shiplynow/shared';

// What the aging reports answer (GET /finance/aging/receivables and /finance/aging/payables).

export interface AgingTotal {
  buckets: AgingBuckets;
  total: number;
}

export interface ReceivableAgingRow {
  merchantId: string;
  name: string;
  phone: string | null;
  balancePiastres: number;
  buckets: AgingBuckets;
  oldestDay: string | null;
  oldestDays: number | null;
  since: string | null;
  daysInDebit: number | null;
  reminders: { count: number; lastAt: string | null };
  lastRequestedAt: string | null;
}

export interface ChequeAgingRow {
  id: string;
  label: string;
  chequeNumber: string;
  partyName: string;
  merchantId: string | null;
  dueDay: string;
  daysLate: number;
  band: AgingBand;
  amountPiastres: number;
}

export interface ReceivablesAging {
  asOf: string;
  merchants: ReceivableAgingRow[];
  merchantTotal: AgingTotal;
  cheques: ChequeAgingRow[];
  chequeTotal: AgingTotal;
  total: AgingTotal;
}

export interface PayableBillRow {
  id: string;
  label: string;
  reference: string;
  billDay: string;
  dueDay: string;
  daysLate: number;
  band: AgingBand;
  currency: string;
  darkStoreId: string | null;
  leftPiastres: number;
}

export interface PayableAgingRow {
  supplierId: string;
  name: string;
  taxId: string | null;
  buckets: AgingBuckets;
  total: number;
  bills: PayableBillRow[];
}

export interface PayablesAging {
  asOf: string;
  suppliers: PayableAgingRow[];
  total: AgingTotal;
}

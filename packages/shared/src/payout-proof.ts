import { z } from 'zod';

// Merchant payouts: the statement of account (SOA) frozen when a payout is prepared, the proof
// of transfer (POT: the bank slip with the amount and reference typed from it) and the checks
// Accounting ticks before marking a payout paid. A payout is paid only when the SOA's net,
// the POT's amount and the payout's amount are the same number of piastres.

const pad = (n: number) => String(n).padStart(6, '0');
/** Statement of account number, for example SOA-000012 */
export const soaNumber = (n: number) => `SOA-${pad(n)}`;
/** Proof of transfer number, for example POT-000012 */
export const proofNumber = (n: number) => `POT-${pad(n)}`;

export const PAYOUT_PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const PAYOUT_PROOF_MAX_BYTES = 5 * 1024 * 1024;

/** The code of the system check: someone other than the payer viewed the SOA and the POT. */
export const SECOND_PERSON_CHECK = 'second_person_viewed';

/** The upload's details travel in the query; the body is the file itself. */
export const payoutProofQuerySchema = z.object({
  name: z.string().trim().min(1).max(120),
  amountPiastres: z.coerce.number().int().min(1).max(1_000_000_000),
  reference: z.string().trim().min(2).max(100),
});

export const payoutCheckCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'invalid_code'),
  labelEn: z.string().trim().min(3).max(160),
  labelAr: z.string().trim().min(3).max(160),
  sort: z.number().int().min(0).max(999).optional(),
});

export const payoutCheckUpdateSchema = z.object({
  labelEn: z.string().trim().min(3).max(160).optional(),
  labelAr: z.string().trim().min(3).max(160).optional(),
  active: z.boolean().optional(),
  sort: z.number().int().min(0).max(999).optional(),
});

export const payoutCheckMarkSchema = z.object({
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/** One order of the period: the cash collected for it and each fee taken, VAT included. */
export interface StatementOrder {
  orderId: string;
  orderNumber: string;
  /** Cash collected for the merchant (positive) */
  codPiastres: number;
  /** Fees by kind as they reached the merchant's balance (negative), VAT included */
  fees: Record<string, number>;
  /** The VAT inside those fees (negative), and given back by credit notes (positive) */
  vatPiastres: number;
  netPiastres: number;
}

export interface StatementMovement {
  at: string;
  kind: string;
  memo: string | null;
  orderNumber: string | null;
  /** From the merchant's side: positive adds to what we owe them */
  amountPiastres: number;
  vatPiastres: number;
  balanceAfterPiastres: number;
}

/** The frozen statement of account of one payout (payout_statements.data). */
export interface PayoutStatementData {
  version: 1;
  number: string;
  payout: { id: string; number: string; cutoffDay: string };
  merchant: { id: string; name: string };
  /** The period: from the previous paid payout's cutoff (or the merchant's start) to this cutoff */
  from: string;
  to: string;
  fromDay: string;
  toDay: string;
  openingPiastres: number;
  /** Every kind of movement in the period, VAT included (from the merchant's side) */
  byKind: Record<string, number>;
  /** The VAT inside each kind */
  vatByKind: Record<string, number>;
  vatPiastres: number;
  closingPiastres: number;
  /** Charges booked after the cutoff that lowered what is paid now */
  heldBackPiastres: number;
  /** What is transferred: the payout's amount */
  netPiastres: number;
  orders: StatementOrder[];
  /** Movements not about one order (receipts, storage, receiving, adjustments, notes, payouts) */
  other: StatementMovement[];
  lines: StatementMovement[];
  frozenAt: string;
}

/** The kinds in the order a statement shows them; any other kind comes after. */
export const STATEMENT_KIND_ORDER = [
  'cod_collected',
  'shipping_fee',
  'product_handling',
  'order_fee',
  'cod_fee',
  'failed_fee',
  'packaging_charge',
  'receiving_fee',
  'storage_fee',
  'return_fee',
  'damage_compensation',
  'credit_note',
  'debit_note',
  'adjustment',
  'merchant_receipt',
  'merchant_payout',
] as const;

export function sortKinds(kinds: string[]) {
  const rank = (k: string) => {
    const i = (STATEMENT_KIND_ORDER as readonly string[]).indexOf(k);
    return i < 0 ? STATEMENT_KIND_ORDER.length : i;
  };
  return [...kinds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Whether the three numbers agree: the SOA's net, the POT's amount and the payout's amount. */
export function payoutMatches(input: {
  amountPiastres: number;
  soaNetPiastres: number | null;
  potAmountPiastres: number | null;
}) {
  return (
    input.soaNetPiastres === input.amountPiastres &&
    input.potAmountPiastres === input.amountPiastres
  );
}

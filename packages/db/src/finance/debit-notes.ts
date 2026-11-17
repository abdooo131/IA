import { DEBIT_NOTE_KINDS, type DebitNoteKind } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { submitMovement } from './controls';
import { FEE_KINDS, invoiceLabel, nextDocumentNumber } from './invoices';
import { post, share } from './ledger';
import { postPostalFee } from './postings';

// Debit notes (DN-000001): the counterpart of credit notes. After a month's invoice was issued,
// finance charges the merchant more (a fee that was missed, a correction). A debit note:
//
//   - always names an invoice of the merchant (it adds to that invoice). The e-invoice system
//     needs the original document for a debit note, and every fee we charge belongs to a month
//     that is invoiced; a fee of a month not invoiced yet is simply booked and lands on that
//     month's invoice. So there is no standalone debit note;
//   - has one line per fee kind with its amount before VAT; VAT is the global fee VAT rate
//     (fee.vat_bp) read when the note is asked for, so the second person approves exactly the
//     amounts that will be booked;
//   - books Dr merchant wallet (net + VAT), Cr fee income (net), Cr VAT payable (VAT) as one
//     entry of kind debit_note, tagged with the merchant and, when given, the store;
//   - raises what the merchant owes us, so it waits for a second person like every merchant
//     balance change while finance.approve_money_in is on (nobody approves their own);
//   - is fixed once issued (the tax_invoices trigger) and goes through the e-invoice flow as an
//     ETA document of type "D" referencing the invoice's uuid, after the invoice was accepted.
//
// Its entry kind is not a monthly fee kind, so the next monthly invoice never counts it again.

export interface DebitNoteLineInput {
  kind: DebitNoteKind;
  quantity?: number;
  /** The fee before VAT */
  netPiastres: number;
}

export interface DebitNoteInput {
  invoiceId: string;
  lines: DebitNoteLineInput[];
  reason: string;
  darkStoreId?: string | null;
  /** The VAT rate (basis points) frozen when the note was asked for; else fee.vat_bp now */
  vatBp?: number;
  /** What the merchant will owe more, VAT included (shown on the approval request) */
  amountPiastres?: number;
  actorUserId: string;
  idempotencyKey: string;
}

function checkLines(lines: DebitNoteLineInput[]) {
  if (lines.length === 0 || lines.length > 20) throw new DomainError('invalid_lines', 400);
  for (const l of lines) {
    if (!(DEBIT_NOTE_KINDS as readonly string[]).includes(l.kind))
      throw new DomainError('invalid_fee_kind', 400);
    if (!Number.isSafeInteger(l.netPiastres) || l.netPiastres <= 0)
      throw new DomainError('invalid_amount', 400);
    const q = l.quantity ?? 1;
    if (!Number.isSafeInteger(q) || q <= 0) throw new DomainError('invalid_quantity', 400);
  }
}

/** The lines with their VAT at a rate, and the totals. */
export function debitNoteAmounts(lines: DebitNoteLineInput[], vatBp: number) {
  const priced = lines.map((l) => ({
    kind: l.kind,
    quantity: l.quantity ?? 1,
    netPiastres: l.netPiastres,
    vatPiastres: share(l.netPiastres, vatBp),
  }));
  const net = priced.reduce((s, l) => s + l.netPiastres, 0);
  const vat = priced.reduce((s, l) => s + l.vatPiastres, 0);
  return { lines: priced, netPiastres: net, vatPiastres: vat, totalPiastres: net + vat };
}

/**
 * Issues a debit note against an invoice: books the extra fees and their VAT and makes the
 * DN document. A repeat with the same idempotency key returns the first entry.
 */
export async function issueDebitNote(db: Db, input: DebitNoteInput) {
  checkLines(input.lines);
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError('reason_required', 400);
  return inTransaction(db, async (tx) => {
    const key = `debit_note:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const invoice = await tx.taxInvoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice || invoice.type !== 'invoice') throw new DomainError('invoice_not_found', 404);
    const storeId = input.darkStoreId || null;
    if (storeId && !(await tx.darkStore.findUnique({ where: { id: storeId } })))
      throw new DomainError('store_not_found', 404);
    const vatBp = input.vatBp ?? (await getSetting(tx, 'fee.vat_bp'));
    const amounts = debitNoteAmounts(input.lines, vatBp);
    const entry = await post(tx, {
      kind: 'debit_note',
      idempotencyKey: key,
      createdById: input.actorUserId,
      memo: reason,
      merchantId: invoice.merchantId,
      darkStoreId: storeId,
      data: {
        invoiceId: invoice.id,
        reason,
        vatBp,
        lines: amounts.lines.map((l) => ({ kind: l.kind, net: l.netPiastres, vat: l.vatPiastres })),
      },
      lines: [
        {
          account: { type: 'merchant', merchantId: invoice.merchantId },
          amount: amounts.totalPiastres,
        },
        { account: { type: 'revenue' }, amount: -amounts.netPiastres },
        { account: { type: 'vat_payable' }, amount: -amounts.vatPiastres },
      ],
    });
    // Extra fees are fee revenue: the postal authority's share of them (our cost).
    await postPostalFee(tx, {
      idempotencyKey: `${key}:postal_fee`,
      basePiastres: amounts.netPiastres,
      merchantId: invoice.merchantId,
      darkStoreId: storeId,
      now: entry!.occurredAt,
      actorUserId: input.actorUserId,
      memo: reason,
      data: { invoiceId: invoice.id },
    });
    const note = await tx.taxInvoice.create({
      data: {
        type: 'debit_note',
        number: await nextDocumentNumber(tx, 'debit_note'),
        merchantId: invoice.merchantId,
        originalId: invoice.id,
        reason,
        netPiastres: amounts.netPiastres,
        vatPiastres: amounts.vatPiastres,
        totalPiastres: amounts.totalPiastres,
        entryId: entry!.id,
        createdById: input.actorUserId,
        lines: {
          create: amounts.lines.map((l, i) => ({
            lineNo: i + 1,
            kind: l.kind,
            descriptionEn: `${FEE_KINDS[l.kind]!.en}: ${reason}`.slice(0, 500),
            descriptionAr: `${FEE_KINDS[l.kind]!.ar}: ${reason}`.slice(0, 500),
            quantity: l.quantity,
            netPiastres: l.netPiastres,
            vatPiastres: l.vatPiastres,
          })),
        },
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.debit_note',
      entityType: 'tax_invoice',
      entityId: note.id,
      after: {
        number: invoiceLabel('debit_note', note.number),
        invoice: invoiceLabel('invoice', invoice.number),
        net: amounts.netPiastres,
        vat: amounts.vatPiastres,
        darkStoreId: storeId,
      },
    });
    return entry!;
  });
}

/**
 * Asks for a debit note: checked now (the invoice, the store, the amounts), with the VAT rate
 * of today frozen on the request. It raises what the merchant owes, so it waits for a second
 * person while finance.approve_money_in is on; otherwise it is issued at once.
 */
export async function submitDebitNote(db: Db, input: DebitNoteInput) {
  checkLines(input.lines);
  if (input.reason.trim().length < 5) throw new DomainError('reason_required', 400);
  const invoice = await db.taxInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice || invoice.type !== 'invoice') throw new DomainError('invoice_not_found', 404);
  if (input.darkStoreId && !(await db.darkStore.findUnique({ where: { id: input.darkStoreId } })))
    throw new DomainError('store_not_found', 404);
  const vatBp = await getSetting(db, 'fee.vat_bp');
  const { actorUserId, ...rest } = input;
  return submitMovement(
    db,
    {
      kind: 'debit_note',
      input: {
        ...rest,
        reason: input.reason.trim(),
        darkStoreId: input.darkStoreId || null,
        vatBp,
        amountPiastres: debitNoteAmounts(input.lines, vatBp).totalPiastres,
      },
    },
    actorUserId,
  );
}

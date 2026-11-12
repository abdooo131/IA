import type { Prisma } from '@prisma/client';
import {
  cairoDay,
  chequeLabel,
  PAYOUT_PROOF_MAX_BYTES,
  PAYOUT_PROOF_TYPES,
  type PayoutStatementData,
  payoutMatches,
  payoutNumber,
  proofNumber,
  SECOND_PERSON_CHECK,
  type StatementMovement,
  type StatementOrder,
  soaNumber,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { looksLike } from '../hr-documents';
import { merchantStatement } from './reports';

type Tx = Prisma.TransactionClient;

// Merchant payouts carry a statement of account (SOA) frozen when they are prepared and a
// proof of transfer (POT) uploaded before they are marked paid; Accounting ticks the active
// payout checks in between (the system check: a second person, not the payer, viewed both).
// The SOA reuses merchantStatement, the statement merchants see in their wallet, so its
// numbers are the wallet's numbers. Flow: prepare (SOA frozen) → approve when the amount
// needs it → upload POT → checks ticked → mark paid (posts the ledger as before).

const negate = (value: number) => 0 - value;

/** Gapless numbers for SOA and POT, taken under an advisory lock inside the transaction. */
async function nextControlNumber(tx: Tx, table: 'payout_statements' | 'payout_proofs') {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'number:' + table}))`;
  const rows = await tx.$queryRawUnsafe<{ max: number | null }[]>(
    `SELECT MAX("number") AS max FROM "${table}"`,
  );
  return (rows[0]?.max ?? 0) + 1;
}

/** The payout cheque registered and not yet booked: the payout's proof instead of a slip. */
function livePayoutCheque(tx: Db, payoutId: string) {
  return tx.cheque.findFirst({
    where: { payoutId, purpose: 'payout', status: 'awaiting_approval' },
    select: { id: true, number: true, chequeNumber: true, status: true },
  });
}

// ─── statement of account ──────────────────────────────────────────────────────

/**
 * The statement of one payout: from the previous paid payout's cutoff (or the merchant's
 * start) to this payout's cutoff, per order and by kind with the VAT inside each fee. The
 * closing balance is what was owed at the cutoff; the net is the payout's amount (never more
 * than is owed now, so charges booked after the cutoff are shown as held back).
 */
export async function buildPayoutStatement(
  tx: Db,
  payout: {
    id: string;
    number: number;
    merchantId: string;
    cutoffAt: Date;
    amountPiastres: number;
  },
  soaSerial: number,
): Promise<PayoutStatementData> {
  const merchant = await tx.merchant.findUniqueOrThrow({
    where: { id: payout.merchantId },
    select: { id: true, name: true, createdAt: true },
  });
  const previous = await tx.payout.findFirst({
    where: {
      merchantId: payout.merchantId,
      status: 'paid',
      id: { not: payout.id },
      cutoffAt: { lte: payout.cutoffAt },
    },
    orderBy: { cutoffAt: 'desc' },
    select: { cutoffAt: true },
  });
  const start = previous?.cutoffAt ?? merchant.createdAt;
  const from = start < payout.cutoffAt ? start : payout.cutoffAt;
  const s = await merchantStatement(tx, payout.merchantId, from, payout.cutoffAt);

  // The VAT of each entry (fees carry it in the same entry), from the merchant's side.
  const entryIds = [...new Set(s.lines.map((l) => l.entryId))];
  const vatLines = entryIds.length
    ? await tx.ledgerLine.findMany({
        where: { entryId: { in: entryIds }, account: { type: 'vat_payable' } },
        select: { entryId: true, amountPiastres: true },
      })
    : [];
  const vatOfEntry = new Map<string, number>();
  for (const v of vatLines)
    vatOfEntry.set(v.entryId, (vatOfEntry.get(v.entryId) ?? 0) + v.amountPiastres);
  const counted = new Set<string>();

  const lines: StatementMovement[] = s.lines.map((l) => {
    // An entry's VAT is shown once, on its first line in the statement.
    const vat = counted.has(l.entryId) ? 0 : (vatOfEntry.get(l.entryId) ?? 0);
    counted.add(l.entryId);
    return {
      at: l.at.toISOString(),
      kind: l.kind,
      memo: l.memo,
      orderNumber: l.orderNumber,
      amountPiastres: l.amountPiastres,
      vatPiastres: vat,
      balanceAfterPiastres: l.balanceAfterPiastres,
    };
  });

  const vatByKind: Record<string, number> = {};
  const orders = new Map<string, StatementOrder>();
  const other: StatementMovement[] = [];
  for (const [i, l] of lines.entries()) {
    if (l.vatPiastres) vatByKind[l.kind] = (vatByKind[l.kind] ?? 0) + l.vatPiastres;
    const orderId = s.lines[i]!.orderId;
    if (orderId && l.kind !== 'merchant_payout' && l.kind !== 'merchant_receipt') {
      const o = orders.get(orderId) ?? {
        orderId,
        orderNumber: l.orderNumber ?? orderId,
        codPiastres: 0,
        fees: {},
        vatPiastres: 0,
        netPiastres: 0,
      };
      if (l.kind === 'cod_collected') o.codPiastres += l.amountPiastres;
      else o.fees[l.kind] = (o.fees[l.kind] ?? 0) + l.amountPiastres;
      o.vatPiastres += l.vatPiastres;
      o.netPiastres += l.amountPiastres;
      orders.set(orderId, o);
    } else other.push(l);
  }
  const vatPiastres = Object.values(vatByKind).reduce((a, b) => a + b, 0);
  const closing = s.closingOwedPiastres;
  return {
    version: 1,
    number: soaNumber(soaSerial),
    payout: {
      id: payout.id,
      number: payoutNumber(payout.number),
      cutoffDay: cairoDay(new Date(payout.cutoffAt.getTime() - 1)),
    },
    merchant: { id: merchant.id, name: merchant.name },
    from: from.toISOString(),
    to: payout.cutoffAt.toISOString(),
    fromDay: cairoDay(from),
    toDay: cairoDay(new Date(payout.cutoffAt.getTime() - 1)),
    openingPiastres: s.openingOwedPiastres,
    byKind: s.byKind,
    vatByKind,
    vatPiastres,
    closingPiastres: closing,
    heldBackPiastres: closing - payout.amountPiastres,
    netPiastres: payout.amountPiastres,
    orders: [...orders.values()],
    other,
    lines,
    frozenAt: new Date().toISOString(),
  };
}

/**
 * Freezes the payout's statement of account (SOA-000001), once: a payout that has one keeps
 * it. Called in the same transaction as createPayout; a draft prepared before statements
 * existed gets its own when its proof is uploaded.
 */
export async function freezePayoutStatement(tx: Tx, payoutId: string, actorUserId: string | null) {
  const existing = await tx.payoutStatement.findUnique({ where: { payoutId } });
  if (existing) return existing;
  const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
  const number = await nextControlNumber(tx, 'payout_statements');
  const data = await buildPayoutStatement(tx, payout, number);
  if (data.netPiastres !== payout.amountPiastres) throw new DomainError('soa_mismatch', 409);
  const row = await tx.payoutStatement.create({
    data: {
      number,
      payoutId: payout.id,
      merchantId: payout.merchantId,
      periodFrom: new Date(data.from),
      periodTo: new Date(data.to),
      openingPiastres: data.openingPiastres,
      closingPiastres: data.closingPiastres,
      heldBackPiastres: data.heldBackPiastres,
      netPiastres: data.netPiastres,
      data: data as unknown as Prisma.InputJsonValue,
      createdById: actorUserId,
    },
  });
  await recordAudit(tx, {
    actorUserId,
    action: 'finance.payout_statement',
    entityType: 'payout',
    entityId: payout.id,
    after: {
      number: data.number,
      opening: data.openingPiastres,
      closing: data.closingPiastres,
      net: data.netPiastres,
      orders: data.orders.length,
    },
  });
  return row;
}

/** A payout's frozen statement; merchantId limits it to that merchant's payouts (404 otherwise). */
export async function getPayoutStatement(db: Db, payoutId: string, merchantId?: string) {
  const row = await db.payoutStatement.findUnique({ where: { payoutId } });
  if (!row || (merchantId && row.merchantId !== merchantId))
    throw new DomainError('statement_not_found', 404);
  return row.data as unknown as PayoutStatementData;
}

// ─── proof of transfer ─────────────────────────────────────────────────────────

/**
 * Attaches the proof of transfer (the bank slip: PDF, JPEG or PNG, at most 5 MB) with the
 * amount and reference typed from it. The amount must be the payout's amount. While the
 * payout is a draft a wrong proof can be replaced (its number is kept); the checks ticked
 * on the old one are cleared, since they confirmed another file. Audited.
 */
export async function addPayoutProof(
  db: Db,
  input: {
    payoutId: string;
    fileName: string;
    contentType: string;
    data: Buffer;
    amountPiastres: number;
    reference: string;
    actorUserId: string;
  },
) {
  if (!(PAYOUT_PROOF_TYPES as readonly string[]).includes(input.contentType))
    throw new DomainError('file_type_not_allowed', 400);
  if (!input.data.length || input.data.length > PAYOUT_PROOF_MAX_BYTES)
    throw new DomainError('file_too_large', 400);
  if (!looksLike(input.contentType, input.data))
    throw new DomainError('file_type_not_allowed', 400);
  const reference = input.reference.trim();
  if (reference.length < 2) throw new DomainError('pot_required', 400);
  return inTransaction(db, async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: input.payoutId } });
    if (!payout) throw new DomainError('payout_not_found', 404);
    if (payout.status !== 'draft') throw new DomainError('payout_not_draft');
    // A payout paid by cheque has the cheque as its proof.
    if (await livePayoutCheque(tx, payout.id)) throw new DomainError('payout_has_cheque');
    if (input.amountPiastres !== payout.amountPiastres)
      throw new DomainError('pot_amount_mismatch', 409, {
        amountPiastres: input.amountPiastres,
        payoutPiastres: payout.amountPiastres,
      });
    // A draft prepared before statements existed gets its statement now.
    await freezePayoutStatement(tx, payout.id, input.actorUserId);
    const existing = await tx.payoutProof.findUnique({
      where: { payoutId: payout.id },
      select: { id: true, number: true, fileName: true, amountPiastres: true, reference: true },
    });
    const file = {
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.data.length,
      data: new Uint8Array(input.data),
      amountPiastres: input.amountPiastres,
      reference,
      uploadedById: input.actorUserId,
    };
    let cleared = 0;
    const proof = existing
      ? await tx.payoutProof.update({ where: { id: existing.id }, data: file })
      : await tx.payoutProof.create({
          data: {
            ...file,
            number: await nextControlNumber(tx, 'payout_proofs'),
            payoutId: payout.id,
          },
        });
    if (existing)
      cleared = (await tx.payoutCheckMark.deleteMany({ where: { payoutId: payout.id } })).count;
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: existing ? 'finance.payout_proof_replace' : 'finance.payout_proof',
      entityType: 'payout',
      entityId: payout.id,
      before: existing
        ? {
            number: proofNumber(existing.number),
            file: existing.fileName,
            amount: existing.amountPiastres,
            reference: existing.reference,
          }
        : null,
      after: {
        number: proofNumber(proof.number),
        file: proof.fileName,
        bytes: proof.sizeBytes,
        amount: proof.amountPiastres,
        reference: proof.reference,
        checksCleared: cleared,
      },
    });
    return {
      id: proof.id,
      number: proofNumber(proof.number),
      amountPiastres: proof.amountPiastres,
      reference: proof.reference,
    };
  });
}

/** The proof's file; merchantId limits it to that merchant's paid payouts (404 otherwise). */
export async function getPayoutProofFile(db: Db, payoutId: string, merchantId?: string) {
  const proof = await db.payoutProof.findUnique({
    where: { payoutId },
    include: { payout: { select: { merchantId: true, status: true } } },
  });
  if (
    !proof ||
    (merchantId && (proof.payout.merchantId !== merchantId || proof.payout.status !== 'paid'))
  )
    throw new DomainError('proof_not_found', 404);
  return {
    fileName: `${proofNumber(proof.number)}-${proof.fileName}`,
    contentType: proof.contentType,
    data: proof.data,
  };
}

// ─── payout checks ─────────────────────────────────────────────────────────────

const SYSTEM_CHECKS = [
  {
    id: 'payout_check_second_person_viewed',
    code: SECOND_PERSON_CHECK,
    labelEn: 'Second person viewed the statement and the proof of transfer',
    labelAr: 'شخص ثان راجع كشف الحساب وإثبات التحويل',
    active: true,
    system: true,
    sort: 0,
  },
];

/** The system checks always exist (the migration adds them; this repairs an emptied table). */
export async function ensurePayoutChecks(db: Db) {
  await db.payoutCheck.createMany({ data: SYSTEM_CHECKS, skipDuplicates: true });
}

export async function listPayoutChecks(db: Db, options: { activeOnly?: boolean } = {}) {
  await ensurePayoutChecks(db);
  return db.payoutCheck.findMany({
    where: options.activeOnly ? { active: true } : undefined,
    orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    include: { createdBy: { select: { name: true } } },
  });
}

const checkSnapshot = (c: {
  code: string;
  labelEn: string;
  labelAr: string;
  active: boolean;
  sort: number;
}) => ({ code: c.code, labelEn: c.labelEn, labelAr: c.labelAr, active: c.active, sort: c.sort });

/** A new check (accounting manage); every payout still a draft then needs it ticked. */
export function createPayoutCheck(
  db: Db,
  input: { code: string; labelEn: string; labelAr: string; sort?: number; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    if (await tx.payoutCheck.findUnique({ where: { code: input.code } }))
      throw new DomainError('check_code_taken', 409);
    const check = await tx.payoutCheck.create({
      data: {
        code: input.code,
        labelEn: input.labelEn,
        labelAr: input.labelAr,
        sort: input.sort ?? 10,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payout_check_create',
      entityType: 'payout_check',
      entityId: check.id,
      after: checkSnapshot(check),
    });
    return check;
  });
}

/** Edits a check's labels, order or switch; a system check cannot be switched off. */
export function updatePayoutCheck(
  db: Db,
  input: {
    id: string;
    labelEn?: string;
    labelAr?: string;
    active?: boolean;
    sort?: number;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.payoutCheck.findUnique({ where: { id: input.id } });
    if (!before) throw new DomainError('check_not_found', 404);
    if (before.system && input.active === false) throw new DomainError('check_is_system', 409);
    const after = await tx.payoutCheck.update({
      where: { id: before.id },
      data: {
        labelEn: input.labelEn,
        labelAr: input.labelAr,
        active: input.active,
        sort: input.sort,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payout_check_update',
      entityType: 'payout_check',
      entityId: before.id,
      before: checkSnapshot(before),
      after: checkSnapshot(after),
    });
    return after;
  });
}

/**
 * Ticks one check on a draft payout (accounting use; audited). The second person check needs
 * the statement and the proof first, since it confirms both were viewed; whoever ticks it may
 * not be the one who marks the payout paid (checked then). Ticking twice changes nothing.
 */
export function markPayoutCheck(
  db: Db,
  input: { payoutId: string; checkId: string; note?: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const payout = await tx.payout.findUnique({
      where: { id: input.payoutId },
      include: { statement: { select: { id: true } }, proof: { select: { id: true } } },
    });
    if (!payout) throw new DomainError('payout_not_found', 404);
    if (payout.status !== 'draft') throw new DomainError('payout_not_draft');
    const check = await tx.payoutCheck.findUnique({ where: { id: input.checkId } });
    if (!check || !check.active) throw new DomainError('check_not_found', 404);
    const seen = await tx.payoutCheckMark.findUnique({
      where: { payoutId_checkId: { payoutId: payout.id, checkId: check.id } },
    });
    if (seen) return seen;
    if (check.code === SECOND_PERSON_CHECK) {
      // The proof is the bank slip, or the cheque registered for the payout.
      if (!payout.proof && !(await livePayoutCheque(tx, payout.id)))
        throw new DomainError('pot_required', 409);
      if (!payout.statement) throw new DomainError('soa_mismatch', 409);
    }
    const mark = await tx.payoutCheckMark.create({
      data: {
        payoutId: payout.id,
        checkId: check.id,
        userId: input.actorUserId,
        note: input.note ?? null,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payout_check',
      entityType: 'payout',
      entityId: payout.id,
      after: { check: check.code, note: input.note ?? null },
    });
    return mark;
  });
}

// ─── ready to pay ──────────────────────────────────────────────────────────────

/**
 * What marking a payout paid by transfer needs, beyond the existing rules: its proof of
 * transfer (pot_required), the proof's amount equal to the payout (pot_amount_mismatch), the
 * frozen statement's net equal to it (soa_mismatch) and every active check ticked
 * (checks_incomplete), the second person check by someone other than the payer (same_person).
 * A payout paid by cheque (chequeId) has the cheque as its proof instead of a bank slip.
 * Returns the proof's reference.
 */
export async function assertReadyToPay(
  tx: Tx,
  payout: { id: string; amountPiastres: number },
  payerId: string,
  options: { chequeId?: string } = {},
) {
  const [proof, statement, checks, marks] = await Promise.all([
    options.chequeId
      ? tx.cheque
          .findUniqueOrThrow({
            where: { id: options.chequeId },
            select: { amountPiastres: true, number: true, chequeNumber: true },
          })
          .then((c) => ({
            amountPiastres: c.amountPiastres,
            reference: `${chequeLabel(c.number)} ${c.chequeNumber}`,
          }))
      : tx.payoutProof.findUnique({
          where: { payoutId: payout.id },
          select: { amountPiastres: true, reference: true },
        }),
    tx.payoutStatement.findUnique({
      where: { payoutId: payout.id },
      select: { netPiastres: true },
    }),
    listPayoutChecks(tx, { activeOnly: true }),
    tx.payoutCheckMark.findMany({ where: { payoutId: payout.id } }),
  ]);
  if (!proof) throw new DomainError('pot_required', 409);
  if (proof.amountPiastres !== payout.amountPiastres)
    throw new DomainError('pot_amount_mismatch', 409);
  if (!statement || statement.netPiastres !== payout.amountPiastres)
    throw new DomainError('soa_mismatch', 409);
  const missing = checks.filter((c) => !marks.some((m) => m.checkId === c.id));
  if (missing.length)
    throw new DomainError('checks_incomplete', 409, {
      missing: missing.map((c) => c.code).join(','),
    });
  const second = checks.find((c) => c.code === SECOND_PERSON_CHECK);
  if (second && marks.find((m) => m.checkId === second.id)?.userId === payerId)
    throw new DomainError('same_person', 403);
  return { reference: proof.reference };
}

/** The SOA, POT and checks of one payout, for the payout page and the Pay merchants run. */
export async function payoutControls(db: Db, payoutId: string, viewerId?: string) {
  const payout = await db.payout.findUnique({
    where: { id: payoutId },
    include: {
      statement: true,
      proof: {
        select: {
          id: true,
          number: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          amountPiastres: true,
          reference: true,
          createdAt: true,
          uploadedBy: { select: { id: true, name: true } },
        },
      },
      checkMarks: { include: { user: { select: { id: true, name: true } } } },
      cheques: {
        where: { status: { notIn: ['cancelled', 'bounced'] } },
        select: { id: true, number: true, chequeNumber: true, status: true },
        orderBy: { number: 'desc' },
        take: 1,
      },
    },
  });
  if (!payout) throw new DomainError('payout_not_found', 404);
  const checks = await listPayoutChecks(db, { activeOnly: true });
  const soa = payout.statement
    ? {
        number: soaNumber(payout.statement.number),
        openingPiastres: payout.statement.openingPiastres,
        closingPiastres: payout.statement.closingPiastres,
        heldBackPiastres: payout.statement.heldBackPiastres,
        netPiastres: payout.statement.netPiastres,
        fromDay: cairoDay(payout.statement.periodFrom),
        toDay: cairoDay(new Date(payout.statement.periodTo.getTime() - 1)),
        frozenAt: payout.statement.createdAt.toISOString(),
      }
    : null;
  const pot = payout.proof
    ? {
        number: proofNumber(payout.proof.number),
        fileName: payout.proof.fileName,
        contentType: payout.proof.contentType,
        sizeBytes: payout.proof.sizeBytes,
        amountPiastres: payout.proof.amountPiastres,
        reference: payout.proof.reference,
        uploadedAt: payout.proof.createdAt.toISOString(),
        uploadedBy: payout.proof.uploadedBy.name,
      }
    : null;
  const rows = checks.map((c) => {
    const mark = payout.checkMarks.find((m) => m.checkId === c.id) ?? null;
    return {
      id: c.id,
      code: c.code,
      labelEn: c.labelEn,
      labelAr: c.labelAr,
      system: c.system,
      mark: mark
        ? {
            by: mark.user.name,
            byId: mark.user.id,
            at: mark.createdAt.toISOString(),
            note: mark.note,
            mine: mark.user.id === viewerId,
          }
        : null,
    };
  });
  const chequeRow = payout.cheques[0] ?? null;
  const cheque = chequeRow
    ? {
        id: chequeRow.id,
        number: chequeLabel(chequeRow.number),
        chequeNumber: chequeRow.chequeNumber,
        status: chequeRow.status,
      }
    : null;
  const blockers: string[] = [];
  if (payout.status === 'draft') {
    // A registered cheque is the proof; otherwise the bank slip must be uploaded.
    if (!cheque && !pot) blockers.push('pot_required');
    else if (pot && pot.amountPiastres !== payout.amountPiastres)
      blockers.push('pot_amount_mismatch');
    if (!soa || soa.netPiastres !== payout.amountPiastres) blockers.push('soa_mismatch');
    if (rows.some((r) => !r.mark)) blockers.push('checks_incomplete');
    const second = rows.find((r) => r.code === SECOND_PERSON_CHECK);
    if (second?.mark && viewerId && second.mark.byId === viewerId) blockers.push('same_person');
  }
  return {
    payoutId: payout.id,
    status: payout.status,
    amountPiastres: payout.amountPiastres,
    soa,
    pot,
    paidByCheque: cheque !== null,
    /** The cheque that pays it (waiting for the checks, issued or cleared), if any */
    cheque,
    checks: rows,
    matches: payoutMatches({
      amountPiastres: payout.amountPiastres,
      soaNetPiastres: soa?.netPiastres ?? null,
      potAmountPiastres: pot?.amountPiastres ?? (cheque ? payout.amountPiastres : null),
    }),
    /** Why the viewer could not mark it paid now (empty: they can) */
    blockers,
  };
}

// ─── CSV ───────────────────────────────────────────────────────────────────────

const BOM = String.fromCharCode(0xfeff);
const csvCell = (value: string | null) => {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const plain = (piastres: number) => {
  const sign = piastres < 0 ? '-' : '';
  const abs = Math.abs(piastres);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
const stamp = (iso: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

/** The frozen statement as CSV (UTF-8 with a BOM for Excel; house rules for formulas). */
export function payoutStatementCsv(s: PayoutStatementData) {
  const rows: (string | null)[][] = [
    ['statement', s.number, 'payout', s.payout.number, 'merchant', s.merchant.name],
    ['date_cairo', 'type', 'order', 'reference', 'amount_egp', 'vat_egp', 'balance_egp'],
    [stamp(s.from), 'opening_balance', null, null, null, null, plain(s.openingPiastres)],
    ...s.lines.map((l) => [
      stamp(l.at),
      l.kind,
      l.orderNumber,
      l.orderNumber ? null : l.memo,
      plain(l.amountPiastres),
      plain(l.vatPiastres),
      plain(l.balanceAfterPiastres),
    ]),
    [
      stamp(new Date(new Date(s.to).getTime() - 1).toISOString()),
      'closing_balance',
      null,
      null,
      null,
      plain(s.vatPiastres),
      plain(s.closingPiastres),
    ],
    [null, 'held_back_after_cutoff', null, null, plain(negate(s.heldBackPiastres)), null, null],
    [null, 'net_to_transfer', null, null, plain(s.netPiastres), null, null],
  ];
  return `${BOM}${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

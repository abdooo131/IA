import {
  addDays,
  cairoDay,
  isCalendarDay,
  loanNumber,
  loanSchedule,
  type LoanMethodName,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { eventTime, mustHold, openAccount } from './books';
import { submitMovement } from './controls';
import { assertPeriodOpen, nextAccountCode, post } from './ledger';

// Money the company borrowed. In Egypt companies borrow only from banks (owner, 2026-11-11):
// new loans name their bank; the older supplier and owner lenders stay readable. Each loan has its own account under 2700 (2701, 2702...) so the balance sheet shows
// what is still owed on each, and a schedule of monthly instalments fixed when it is recorded
// (loanSchedule in packages/shared/src/loans.ts).
//
//   received    Dr bank or cash box                      Cr 2701 loan (amount)
//                 money coming in: waits for a second person while finance.approve_money_in is on
//   instalment  Dr 2701 loan (principal part)  Dr 5904 loan interest (interest part)
//                                                        Cr bank or cash box (instalment)
//                 money going out: waits for a second person from the approval limit
//
// Instalments are paid in their order, each once (key loan_payment:<loan>:<seq>). Interest is
// booked when it is paid; no month end accrual (not needed for the pilot).

const MONEY_GROUPS = [1100, 1200];

export interface LoanInput {
  lender?: 'bank';
  /** The bank's name */
  lenderName: string;
  principalPiastres: number;
  moneyAccountId: string;
  startDay: string;
  annualRateBp: number;
  method?: LoanMethodName;
  months: number;
  firstPaymentDay: string;
  reference: string;
  memo?: string | null;
  actorUserId: string;
  idempotencyKey: string;
}

function checkLoan(input: Omit<LoanInput, 'actorUserId'>) {
  if (!Number.isSafeInteger(input.principalPiastres) || input.principalPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  if (
    !Number.isInteger(input.annualRateBp) ||
    input.annualRateBp < 0 ||
    input.annualRateBp > 100_000
  )
    throw new DomainError('invalid_rate', 400);
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 600)
    throw new DomainError('invalid_months', 400);
  if (!isCalendarDay(input.startDay) || !isCalendarDay(input.firstPaymentDay))
    throw new DomainError('invalid_date', 400);
  if (input.firstPaymentDay <= input.startDay)
    throw new DomainError('first_payment_too_early', 400);
  if ((input.lender ?? 'bank') !== 'bank' || (input.lenderName?.trim().length ?? 0) < 2)
    throw new DomainError('lender_required', 400);
  // The day the money came in is never in the future (eventTime refuses it).
  eventTime(input.startDay);
}

/**
 * Records a loan received (after the second person when one was needed): opens its 2700
 * account, books the money in and fixes the schedule. The same idempotency key records it once.
 */
export async function recordLoan(db: Db, input: LoanInput) {
  checkLoan(input);
  const at = eventTime(input.startDay);
  const key = `loan:${input.idempotencyKey}`;
  return inTransaction(db, async (tx) => {
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return tx.loan.findUniqueOrThrow({ where: { entryId: seen.id } });
    const money = await openAccount(tx, input.moneyAccountId, [1100], 'account_not_found');
    const lenderLabel = input.lenderName.trim();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('number:loans'))`;
    const last = await tx.loan.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
    const number = (last?.number ?? 0) + 1;
    const code = await nextAccountCode(tx, 2700, false);
    const liability = await tx.ledgerAccount.create({
      data: {
        key: `loan:${loanNumber(number)}`,
        type: 'other_liability',
        code,
        groupCode: 2700,
        category: 'liability',
        nameEn: `Loan ${loanNumber(number)} ${lenderLabel}`.slice(0, 120),
        nameAr: `قرض ${loanNumber(number)} ${lenderLabel}`.slice(0, 120),
        createdById: input.actorUserId,
      },
    });
    const entry = await post(tx, {
      kind: 'loan_received',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${loanNumber(number)} ${lenderLabel} ${input.reference}`.trim(),
      data: { reference: input.reference, loanNumber: number },
      lines: [
        { account: { id: money.id }, amount: input.principalPiastres },
        { account: { id: liability.id }, amount: -input.principalPiastres },
      ],
    });
    const method = input.method ?? 'declining';
    const schedule = loanSchedule({
      principalPiastres: input.principalPiastres,
      annualRateBp: input.annualRateBp,
      months: input.months,
      method,
      firstPaymentDay: input.firstPaymentDay,
    });
    const loan = await tx.loan.create({
      data: {
        number,
        lender: 'bank',
        supplierId: null,
        lenderName: lenderLabel,
        principalPiastres: input.principalPiastres,
        moneyAccountId: money.id,
        liabilityAccountId: liability.id,
        startDay: new Date(`${input.startDay}T00:00:00Z`),
        annualRateBp: input.annualRateBp,
        method,
        months: input.months,
        firstPaymentDay: new Date(`${input.firstPaymentDay}T00:00:00Z`),
        reference: input.reference.trim(),
        memo: input.memo?.trim() || null,
        entryId: entry!.id,
        createdById: input.actorUserId,
        instalments: {
          create: schedule.map((r) => ({
            seq: r.seq,
            dueDay: new Date(`${r.dueDay}T00:00:00Z`),
            instalmentPiastres: r.instalmentPiastres,
            interestPiastres: r.interestPiastres,
            principalPiastres: r.principalPiastres,
            remainingPiastres: r.remainingPiastres,
          })),
        },
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.loan_create',
      entityType: 'loan',
      entityId: loan.id,
      after: {
        number: loanNumber(number),
        lender: lenderLabel,
        principal: input.principalPiastres,
        rateBp: input.annualRateBp,
        method,
        months: input.months,
        account: code,
        entry: entry!.number,
      },
    });
    return loan;
  });
}

/** A loan received: money in, so it waits for a second person (finance.approve_money_in). */
export async function submitLoan(db: Db, input: LoanInput & { receiptPhotoId?: string }) {
  checkLoan(input);
  // A day inside closed books is refused when the form is sent, not only at approval.
  await assertPeriodOpen(db, eventTime(input.startDay));
  const { actorUserId, receiptPhotoId, ...rest } = input;
  return submitMovement(
    db,
    { kind: 'loan_in', input: { ...rest, amountPiastres: rest.principalPiastres } },
    actorUserId,
    receiptPhotoId,
  );
}

export interface LoanPaymentInput {
  loanId: string;
  /** The instalment paid; the next unpaid one when left out */
  seq?: number;
  moneyAccountId: string;
  reference: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/**
 * Money at Basata is cash on its way to the bank (a transit account): instalments are paid from
 * a bank or a cash box, never from it.
 */
async function assertLoanMoney(db: Db, accountId: string) {
  const account = await db.ledgerAccount.findUnique({
    where: { id: accountId },
    select: { key: true },
  });
  if (account?.key === 'basata_transit') throw new DomainError('money_account_not_allowed', 400);
}

/** Pays one instalment (the next unpaid one): principal off the loan, interest to 5904. */
export async function payLoanInstalment(db: Db, input: LoanPaymentInput) {
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM loans WHERE id = ${input.loanId} FOR UPDATE`;
    const loan = await tx.loan.findUnique({
      where: { id: input.loanId },
      include: { instalments: { orderBy: { seq: 'asc' } } },
    });
    if (!loan) throw new DomainError('loan_not_found', 404);
    const next = loan.instalments.find((i) => i.paidAt === null);
    const seq = input.seq ?? next?.seq;
    const instalment = loan.instalments.find((i) => i.seq === seq);
    if (!instalment) throw new DomainError('loan_repaid');
    const key = `loan_payment:${loan.id}:${instalment.seq}`;
    if (instalment.paidAt) {
      // Asked again (a retry or a second approval of the same request): the first payment.
      const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
      if (seen) return seen;
      throw new DomainError('instalment_paid');
    }
    if (next && next.seq !== instalment.seq) throw new DomainError('pay_in_order');
    const money = await openAccount(tx, input.moneyAccountId, MONEY_GROUPS, 'account_not_found');
    await assertLoanMoney(tx, money.id);
    await mustHold(tx, money, instalment.instalmentPiastres, at);
    const entry = await post(tx, {
      kind: 'loan_payment',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${loanNumber(loan.number)} ${instalment.seq}/${loan.months} ${input.reference}`,
      data: {
        loanId: loan.id,
        loanNumber: loan.number,
        seq: instalment.seq,
        reference: input.reference,
        principal: instalment.principalPiastres,
        interest: instalment.interestPiastres,
      },
      lines: [
        { account: { id: loan.liabilityAccountId }, amount: instalment.principalPiastres },
        { account: { type: 'loan_interest_expense' }, amount: instalment.interestPiastres },
        { account: { id: money.id }, amount: -instalment.instalmentPiastres },
      ],
    });
    await tx.loanInstalment.update({
      where: { id: instalment.id },
      data: { paidAt: at, entryId: entry!.id },
    });
    const left = loan.instalments.filter((i) => i.paidAt === null && i.id !== instalment.id);
    if (left.length === 0)
      await tx.loan.update({ where: { id: loan.id }, data: { status: 'repaid' } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.loan_payment',
      entityType: 'loan',
      entityId: loan.id,
      before: { paid: loan.instalments.length - left.length - 1 },
      after: {
        seq: instalment.seq,
        amount: instalment.instalmentPiastres,
        interest: instalment.interestPiastres,
        from: money.code,
        entry: entry!.number,
        repaid: left.length === 0,
      },
    });
    return entry!;
  });
}

/**
 * Pays the next instalment at once below the approval limit, otherwise waits for a second
 * person (finance.approval_threshold_piastres), like every money going out.
 */
export async function submitLoanPayment(
  db: Db,
  input: Omit<LoanPaymentInput, 'seq'> & { receiptPhotoId?: string },
) {
  await assertPeriodOpen(db, eventTime(input.day));
  await assertLoanMoney(db, input.moneyAccountId);
  const next = await db.loanInstalment.findFirst({
    where: { loanId: input.loanId, paidAt: null },
    orderBy: { seq: 'asc' },
  });
  if (!next) {
    if (!(await db.loan.findUnique({ where: { id: input.loanId } })))
      throw new DomainError('loan_not_found', 404);
    throw new DomainError('loan_repaid');
  }
  const { actorUserId, receiptPhotoId, ...rest } = input;
  return submitMovement(
    db,
    {
      kind: 'loan_payment',
      input: { ...rest, seq: next.seq, amountPiastres: next.instalmentPiastres },
    },
    actorUserId,
    receiptPhotoId,
  );
}

const dayText = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Every loan with what is still owed and its next instalment, newest first. */
export async function listLoans(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const loans = await db.loan.findMany({
    orderBy: { number: 'desc' },
    include: {
      supplier: { select: { id: true, name: true } },
      liabilityAccount: { select: { id: true, code: true } },
      moneyAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      instalments: { orderBy: { seq: 'asc' } },
    },
  });
  return loans.map((l) => {
    const unpaid = l.instalments.filter((i) => i.paidAt === null);
    const next = unpaid[0] ?? null;
    const owed = unpaid.reduce((s, i) => s + i.principalPiastres, 0);
    return {
      id: l.id,
      number: loanNumber(l.number),
      lender: l.lender,
      lenderName: l.supplier?.name ?? l.lenderName ?? '',
      supplierId: l.supplierId,
      principalPiastres: l.principalPiastres,
      owedPiastres: owed,
      interestLeftPiastres: unpaid.reduce((s, i) => s + i.interestPiastres, 0),
      annualRateBp: l.annualRateBp,
      method: l.method,
      months: l.months,
      paid: l.instalments.length - unpaid.length,
      startDay: dayText(l.startDay)!,
      status: l.status,
      account: l.liabilityAccount,
      moneyAccount: l.moneyAccount,
      next: next && {
        seq: next.seq,
        dueDay: dayText(next.dueDay)!,
        instalmentPiastres: next.instalmentPiastres,
        overdue: dayText(next.dueDay)! < today,
      },
    };
  });
}

/** One loan with its whole schedule and the entries that paid it. */
export async function loanDetail(db: Db, loanId: string) {
  const l = await db.loan.findUnique({
    where: { id: loanId },
    include: {
      supplier: { select: { id: true, name: true } },
      liabilityAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      moneyAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      entry: { select: { id: true, number: true } },
      instalments: {
        orderBy: { seq: 'asc' },
        include: { entry: { select: { id: true, number: true } } },
      },
    },
  });
  if (!l) throw new DomainError('loan_not_found', 404);
  const unpaid = l.instalments.filter((i) => i.paidAt === null);
  return {
    id: l.id,
    number: loanNumber(l.number),
    lender: l.lender,
    lenderName: l.supplier?.name ?? l.lenderName ?? '',
    supplier: l.supplier,
    principalPiastres: l.principalPiastres,
    owedPiastres: unpaid.reduce((s, i) => s + i.principalPiastres, 0),
    annualRateBp: l.annualRateBp,
    method: l.method,
    months: l.months,
    startDay: dayText(l.startDay)!,
    firstPaymentDay: dayText(l.firstPaymentDay)!,
    reference: l.reference,
    memo: l.memo,
    status: l.status,
    account: l.liabilityAccount,
    moneyAccount: l.moneyAccount,
    entry: l.entry,
    totals: {
      instalmentPiastres: l.instalments.reduce((s, i) => s + i.instalmentPiastres, 0),
      interestPiastres: l.instalments.reduce((s, i) => s + i.interestPiastres, 0),
      principalPiastres: l.instalments.reduce((s, i) => s + i.principalPiastres, 0),
    },
    instalments: l.instalments.map((i) => ({
      seq: i.seq,
      dueDay: dayText(i.dueDay)!,
      instalmentPiastres: i.instalmentPiastres,
      interestPiastres: i.interestPiastres,
      principalPiastres: i.principalPiastres,
      remainingPiastres: i.remainingPiastres,
      paidAt: i.paidAt,
      entry: i.entry,
    })),
    nextSeq: unpaid[0]?.seq ?? null,
  };
}

/** Unpaid instalments due within `days` days (overdue ones included), for the Today strip. */
export async function loanInstalmentsDue(db: Db, now: Date = new Date(), days = 7) {
  const until = addDays(cairoDay(now), days);
  const rows = await db.loanInstalment.findMany({
    where: { paidAt: null, dueDay: { lte: new Date(`${until}T00:00:00Z`) } },
    select: { instalmentPiastres: true },
  });
  return {
    count: rows.length,
    amountPiastres: rows.reduce((s, r) => s + r.instalmentPiastres, 0),
  };
}

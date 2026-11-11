import {
  addDays,
  type BulkOutcome,
  cairoClock,
  cairoDay,
  cairoDayStart,
  payoutNumber,
  proofNumber,
  SECOND_PERSON_CHECK,
  soaNumber,
} from '@shiplynow/shared';
import type { Db } from '../client';
import { DomainError } from '../domain-error';
import { approvalThreshold } from './controls';
import { payoutMinimumFor } from './contracts';
import { createPayout, markPayoutPaid, merchantOwed, payoutDueOn } from './operations';
import { listPayoutChecks } from './payout-proof';

// The guided "Pay merchants" run (Accounting UX phase B). Nothing is stored for the run itself:
// where it stands is read from the payouts (drafts, approvals, paid today), so it can be left
// and picked up again. Every step uses the existing rules: createPayout (one open draft per
// merchant, the contract's minimum payout), approvePayout (a second person from the limit,
// never one's own), the bank file of ready payouts, and markPayoutPaid (one transaction each).

export const PAY_RUN_STEPS = ['prepare', 'review', 'approve', 'file', 'pay', 'done'] as const;
export type PayRunStep = (typeof PAY_RUN_STEPS)[number];

const endOfDay = (day: string) => cairoDayStart(addDays(day, 1));

/**
 * Prepares drafts for every active merchant whose payout schedule is due on the Cairo weekday
 * of `now`, of what is owed up to the end of `cutoffDay`. Merchants with nothing owed, below
 * their minimum or with an open draft are listed as skipped with the reason.
 */
export async function prepareDuePayouts(
  db: Db,
  input: { cutoffDay: string; actorUserId: string; now?: Date },
) {
  const weekday = cairoClock(input.now ?? new Date()).weekday;
  const merchants = await db.merchant.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  const created: { merchantId: string; payoutId: string; amountPiastres: number }[] = [];
  const skipped: { merchantId: string; reason: string }[] = [];
  for (const m of merchants) {
    if (!payoutDueOn(m.payoutSchedule, weekday)) {
      skipped.push({ merchantId: m.id, reason: 'not_due_today' });
      continue;
    }
    try {
      const p = await createPayout(db, {
        merchantId: m.id,
        cutoffAt: endOfDay(input.cutoffDay),
        actorUserId: input.actorUserId,
      });
      created.push({ merchantId: m.id, payoutId: p.id, amountPiastres: p.amountPiastres });
    } catch (error) {
      if (error instanceof DomainError) skipped.push({ merchantId: m.id, reason: error.code });
      else throw error;
    }
  }
  return { created, skipped };
}

/** Where today's Pay merchants run stands, worked out from the payouts themselves. */
export async function payoutRun(db: Db, input: { userId: string; cutoffDay?: string; now?: Date }) {
  const now = input.now ?? new Date();
  const today = cairoDay(now);
  const cutoffDay = input.cutoffDay ?? addDays(today, -1);
  const weekday = cairoClock(now).weekday;
  const [merchants, drafts, paidToday, limit] = await Promise.all([
    db.merchant.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        payoutSchedule: true,
        iban: true,
        bankName: true,
        bankAccountNumber: true,
      },
      orderBy: { name: 'asc' },
    }),
    db.payout.findMany({
      where: { status: 'draft' },
      orderBy: { number: 'asc' },
      include: {
        merchant: {
          select: { name: true, iban: true, bankName: true, bankAccountNumber: true },
        },
        approvedBy: { select: { name: true } },
        createdBy: { select: { name: true } },
        proof: { select: { number: true, amountPiastres: true, reference: true } },
        statement: { select: { number: true, netPiastres: true } },
        checkMarks: { select: { checkId: true, userId: true } },
      },
    }),
    db.payout.findMany({
      where: { status: 'paid', paidAt: { gte: cairoDayStart(today), lt: endOfDay(today) } },
      orderBy: { number: 'asc' },
      include: { merchant: { select: { name: true } } },
    }),
    approvalThreshold(db),
  ]);
  const checks = await listPayoutChecks(db, { activeOnly: true });
  const second = checks.find((c) => c.code === SECOND_PERSON_CHECK);
  const hasBank = (m: {
    iban: string | null;
    bankName: string | null;
    bankAccountNumber: string | null;
  }) => !!(m.iban || (m.bankName && m.bankAccountNumber));

  const due = [];
  for (const m of merchants.filter((x) => payoutDueOn(x.payoutSchedule, weekday))) {
    const draft = drafts.find((d) => d.merchantId === m.id) ?? null;
    const paid = paidToday.find((p) => p.merchantId === m.id) ?? null;
    const owed = Math.min(
      await merchantOwed(db, m.id, endOfDay(cutoffDay)),
      await merchantOwed(db, m.id),
    );
    const minimum = await payoutMinimumFor(db, m.id, cutoffDay);
    const state = draft
      ? ('drafted' as const)
      : paid
        ? ('paid_today' as const)
        : owed <= 0
          ? ('nothing_owed' as const)
          : owed < minimum
            ? ('below_minimum' as const)
            : ('ready' as const);
    due.push({
      merchantId: m.id,
      name: m.name,
      schedule: m.payoutSchedule,
      owedPiastres: owed,
      minimumPiastres: minimum,
      bankDetails: hasBank(m),
      draftId: draft?.id ?? null,
      state,
    });
  }

  const draftRows = drafts.map((p) => {
    const needsApproval = limit > 0 && p.amountPiastres >= limit;
    const approved = !!p.approvedById;
    const bank = hasBank(p.merchant);
    return {
      id: p.id,
      number: payoutNumber(p.number),
      merchantId: p.merchantId,
      merchant: p.merchant.name,
      amountPiastres: p.amountPiastres,
      cutoffDay: cairoDay(new Date(p.cutoffAt.getTime() - 1)),
      bankDetails: bank,
      needsApproval,
      approved,
      approvedBy: p.approvedBy?.name ?? null,
      createdBy: p.createdBy.name,
      /** Made by the person looking: they may not approve it */
      mine: p.createdById === input.userId,
      /** In the bank file and payable: approved when it needed it, with bank details */
      ready: (!needsApproval || approved) && bank,
      /** The frozen statement of account (its net is the amount) */
      soa: p.statement
        ? { number: soaNumber(p.statement.number), netPiastres: p.statement.netPiastres }
        : null,
      /** The proof of transfer uploaded for it, if any */
      proof: p.proof
        ? {
            number: proofNumber(p.proof.number),
            amountPiastres: p.proof.amountPiastres,
            reference: p.proof.reference,
          }
        : null,
      /** Active checks ticked, of all active checks */
      checksDone: checks.filter((c) => p.checkMarks.some((m) => m.checkId === c.id)).length,
      checksTotal: checks.length,
      /** The second person check was ticked by the person looking: they may not pay it */
      viewedByMe:
        !!second && p.checkMarks.some((m) => m.checkId === second.id && m.userId === input.userId),
    };
  });

  const emails = paidToday.length
    ? await db.emailOutbox.findMany({
        where: {
          idempotencyKey: {
            in: paidToday.flatMap((p) => [`payout_paid:${p.id}`, `statement:${p.id}`]),
          },
        },
        select: { idempotencyKey: true, status: true },
      })
    : [];
  const paidRows = paidToday.map((p) => ({
    id: p.id,
    number: payoutNumber(p.number),
    merchant: p.merchant.name,
    amountPiastres: p.amountPiastres,
    reference: p.reference,
    paidAt: p.paidAt!.toISOString(),
    emails: emails.filter((e) => e.idempotencyKey.endsWith(`:${p.id}`)).length,
  }));

  const toPrepare = due.filter((d) => d.state === 'ready').length;
  const toApprove = draftRows.filter((d) => d.needsApproval && !d.approved).length;
  const ready = draftRows.filter((d) => d.ready);
  const done: Record<PayRunStep, boolean> = {
    prepare: toPrepare === 0,
    review: draftRows.every((d) => d.bankDetails),
    approve: toApprove === 0,
    file: ready.length === 0,
    pay: ready.length === 0,
    done: false,
  };
  const current: PayRunStep =
    toPrepare > 0
      ? 'prepare'
      : draftRows.length === 0
        ? 'done'
        : toApprove > 0
          ? 'approve'
          : ready.length > 0
            ? 'file'
            : draftRows.some((d) => !d.bankDetails)
              ? 'review'
              : 'done';
  const sum = (rows: { amountPiastres: number }[]) =>
    rows.reduce((s, r) => s + r.amountPiastres, 0);
  return {
    today,
    cutoffDay,
    limitPiastres: limit,
    current,
    done,
    /** Merchants due by schedule today and not yet prepared or paid */
    dueCount: due.filter((d) => d.state === 'ready' || d.state === 'drafted').length,
    due,
    drafts: draftRows,
    paid: paidRows,
    totals: {
      draftsPiastres: sum(draftRows),
      readyPiastres: sum(ready),
      readyCount: ready.length,
      toApprove,
      missingBank: draftRows.filter((d) => !d.bankDetails).length,
      paidPiastres: sum(paidRows),
      emailsQueued: paidRows.reduce((s, p) => s + p.emails, 0),
    },
  };
}

/**
 * Marks several payouts paid on one day: each through markPayoutPaid in its own transaction,
 * so one refusal never stops the others. Each payout needs its own proof of transfer (a row
 * without one is refused with pot_required) and its checks; its reference is the one typed on
 * its proof unless one reference is given for all. A payout already paid (with the given
 * reference, when one is given) counts as done, so pressing twice changes nothing.
 */
export async function markPayoutsPaid(
  db: Db,
  input: {
    ids: string[];
    reference?: string;
    day?: string;
    bankAccountId?: string;
    actorUserId: string;
  },
) {
  const results: (BulkOutcome & { already?: boolean })[] = [];
  for (const id of [...new Set(input.ids)]) {
    const payout = await db.payout.findUnique({ where: { id } });
    if (!payout) {
      results.push({ id, ok: false, error: 'payout_not_found' });
      continue;
    }
    const reference = input.reference?.trim() || undefined;
    if (payout.status === 'paid' && (!reference || payout.reference === reference)) {
      results.push({ id, ok: true, already: true });
      continue;
    }
    try {
      await markPayoutPaid(db, {
        payoutId: id,
        reference,
        bankAccountId: input.bankAccountId,
        day: input.day,
        actorUserId: input.actorUserId,
      });
      results.push({ id, ok: true });
    } catch (error) {
      if (error instanceof DomainError) results.push({ id, ok: false, error: error.code });
      else throw error;
    }
  }
  return { results };
}

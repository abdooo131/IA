import type { Prisma } from '@prisma/client';
import { cairoClock, cairoDay, reminderDue, type ReminderRules } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { merchantEmailTarget, queueEmail } from '../email';
import { paymentReminderEmail } from '../email-templates';
import { notifyMerchant } from '../notifications';
import { getSetting } from '../settings';
import { receivablesAging, type ReceivableAgingRow } from './aging';

type Tx = Prisma.TransactionClient;

// Payment reminders to merchants who owe us (their wallet is in debit).
//
//   wallet turns to debit ──(receivables.reminder_first_days)──▶ reminder 1
//        ──(receivables.reminder_every_days)──▶ reminder 2 ... up to receivables.reminder_max
//   wallet back to zero or credit ──▶ no more reminders; a later debit starts a new period
//
// A reminder is a notification in the merchant panel, an email (kind payment_reminder, to the
// billing emails, unless the merchant opted out) and a web push to their users with the money
// right (sent by the push dispatcher from the notification). Each is audited and counted per
// debit period (merchant_payment_reminders.period_start = when the wallet last turned to debit).
//
// The daily job runs once receivables.reminder_hour has passed in Cairo and never while
// receivables.reminders_enabled is 0. Each automatic reminder has its own key (the merchant,
// the debit period and its number), so a second run or a second API instance sends nothing
// twice. Finance can also press Send reminder now: it is sent even past the maximum (a person
// chose to), and it counts toward the maximum and restarts the wait for the next automatic one.

export async function reminderRules(
  db: Db,
): Promise<ReminderRules & { enabled: boolean; hour: number }> {
  const [enabled, firstDays, everyDays, max, hour] = await Promise.all([
    getSetting(db, 'receivables.reminders_enabled'),
    getSetting(db, 'receivables.reminder_first_days'),
    getSetting(db, 'receivables.reminder_every_days'),
    getSetting(db, 'receivables.reminder_max'),
    getSetting(db, 'receivables.reminder_hour'),
  ]);
  return { enabled: enabled === 1, firstDays, everyDays, max, hour };
}

/** One merchant's debit state now (null when they owe us nothing). */
async function debitState(tx: Tx, merchantId: string, now: Date) {
  const aging = await receivablesAging(tx, { now, merchantIds: [merchantId] });
  return aging.merchants.find((m) => m.merchantId === merchantId) ?? null;
}

/** Sends one reminder (notification, email, audit) inside the caller's transaction. */
async function deliver(
  tx: Tx,
  input: {
    state: ReceivableAgingRow;
    manual: boolean;
    actorUserId: string | null;
    idempotencyKey: string;
    now: Date;
  },
) {
  const seen = await tx.merchantPaymentReminder.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (seen) return { reminder: seen, created: false };
  const { state } = input;
  const number = state.reminders.count + 1;
  const reminder = await tx.merchantPaymentReminder.create({
    data: {
      merchantId: state.merchantId,
      periodStart: state.since!,
      number,
      amountPiastres: state.balancePiastres,
      manual: input.manual,
      sentById: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
    },
  });
  await notifyMerchant(tx, state.merchantId, 'payment_reminder', {
    amountPiastres: state.balancePiastres,
    since: state.since!.toISOString(),
    number,
    oldestDays: state.oldestDays,
  });
  const target = await merchantEmailTarget(tx, state.merchantId, 'payment_reminder');
  if (target)
    await queueEmail(tx, {
      kind: 'payment_reminder',
      merchantId: state.merchantId,
      to: target.to,
      language: target.language,
      email: paymentReminderEmail({
        lang: target.language,
        merchantName: target.name,
        amountPiastres: state.balancePiastres,
        since: state.since!,
        number,
        oldestDays: state.oldestDays,
      }),
      idempotencyKey: input.idempotencyKey,
    });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'finance.payment_reminder',
    entityType: 'merchant',
    entityId: state.merchantId,
    after: {
      amount: state.balancePiastres,
      number,
      manual: input.manual,
      since: state.since!.toISOString(),
      emailed: Boolean(target),
    },
  });
  return { reminder, created: true };
}

/**
 * The daily job: a reminder to every merchant in debit whose next reminder is due today.
 * Safe to run any number of times (each reminder is keyed by merchant, period and number).
 */
export async function runReceivableReminders(db: Db, now: Date = new Date()) {
  const rules = await reminderRules(db);
  if (!rules.enabled) return { status: 'disabled' as const, checked: 0, sent: 0 };
  if (cairoClock(now).minute < rules.hour * 60)
    return { status: 'too_early' as const, checked: 0, sent: 0 };
  const today = cairoDay(now);
  const aging = await receivablesAging(db, { now });
  let sent = 0;
  for (const row of aging.merchants) {
    if (!row.since || !due(row, today, rules)) continue;
    const made = await inTransaction(db, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payment_reminder:' + row.merchantId}))`;
      // Read again under the lock: a payment or another run may have changed it.
      const state = await debitState(tx, row.merchantId, now);
      if (!state?.since || !due(state, today, rules)) return false;
      const key = `receivable_reminder:${state.merchantId}:${state.since.toISOString()}:${state.reminders.count + 1}`;
      return (
        await deliver(tx, { state, manual: false, actorUserId: null, idempotencyKey: key, now })
      ).created;
    });
    if (made) sent++;
  }
  return { status: 'done' as const, checked: aging.merchants.length, sent };
}

function due(row: ReceivableAgingRow, today: string, rules: ReminderRules) {
  return reminderDue(
    {
      sinceDay: cairoDay(row.since!),
      today,
      sent: row.reminders.count,
      lastDay: row.reminders.lastAt ? cairoDay(row.reminders.lastAt) : null,
    },
    rules,
  );
}

/**
 * Send reminder now (finance): one reminder at once to a merchant who owes us. It counts
 * toward receivables.reminder_max and is sent even when the maximum was reached. A repeat
 * with the same idempotency key sends nothing more.
 */
export function sendReminderNow(
  db: Db,
  input: { merchantId: string; actorUserId: string; idempotencyKey: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payment_reminder:' + input.merchantId}))`;
    const key = `receivable_reminder_manual:${input.idempotencyKey}`;
    const seen = await tx.merchantPaymentReminder.findUnique({ where: { idempotencyKey: key } });
    if (seen) return { merchantId: seen.merchantId, number: seen.number, created: false };
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const state = await debitState(tx, merchant.id, now);
    if (!state?.since || state.balancePiastres <= 0) throw new DomainError('nothing_owed');
    const { reminder, created } = await deliver(tx, {
      state,
      manual: true,
      actorUserId: input.actorUserId,
      idempotencyKey: key,
      now,
    });
    return { merchantId: merchant.id, number: reminder.number, created };
  });
}

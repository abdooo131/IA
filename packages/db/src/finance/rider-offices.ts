import type { Prisma } from '@prisma/client';
import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { addMonths } from './assets';
import { balanceOf, lockedBalance, nextNumber, post, share } from './ledger';

type Tx = Prisma.TransactionClient;

// Rider supply offices. An office is a supplier marked as a rider office, with its own
// commission (basis points of the rider pay). A rider paid per delivery is linked to one office
// on their HR file (employment outsourced, staffing supplier = the office). We pay the rider
// exactly as without an office (wallet, hold, withdrawals); the office earns only its
// commission on top:
//
//   each delivery   Dr 5102 rider office commission   Cr 2402 commission accrued
//                   (same transaction as the rider pay, tagged with store, merchant, rider, order)
//   month end       Dr 2500 office wallet              Cr 1350 rider dues
//                   (what a linked rider still owes beyond everything their 2200 wallet holds:
//                   "rider first, then office")
//   monthly bill    Dr 2402 accrued   Dr VAT (office with a tax number)   Cr 2500 office wallet
//                   a normal supplier bill (BILL-), paid with payBill (withholding, cheques,
//                   second person rule); the shortages already on the wallet are set off when
//                   paying (offsetPiastres), or carry into the next month when larger.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The first moment of a Cairo month and of the next one. */
export function monthRange(month: string) {
  if (!MONTH.test(month)) throw new DomainError('invalid_month', 400);
  return {
    from: cairoDayStart(`${month}-01`),
    to: cairoDayStart(`${addMonths(month, 1)}-01`),
  };
}

/** The month's last day (YYYY-MM-DD). */
const lastDayOf = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/** The office a rider is linked to on their HR file, when it is an active rider office. */
export async function riderOfficeOf(db: Db, riderId: string) {
  const rider = await db.rider.findUnique({
    where: { id: riderId },
    select: {
      user: {
        select: {
          employee: {
            select: {
              employment: true,
              staffingSupplier: {
                select: {
                  id: true,
                  name: true,
                  isRiderOffice: true,
                  isActive: true,
                  commissionBp: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const e = rider?.user.employee;
  const office = e?.employment === 'outsourced' ? e.staffingSupplier : null;
  if (!office || !office.isRiderOffice || !office.isActive) return null;
  return { id: office.id, name: office.name, commissionBp: office.commissionBp };
}

/**
 * The office's commission on one delivery, posted in the same transaction as the rider pay:
 * round(pay × bp / 10,000) at the office's rate of this moment. Nothing for a rider without an
 * office (or at 0). Its own key per delivery, so posting twice changes nothing.
 */
export async function postRiderOfficeCommission(
  tx: Tx,
  input: {
    deliveryId: string;
    riderId: string;
    orderId: string;
    payPiastres: number;
    now: Date;
    actorUserId: string | null;
    memo?: string;
  },
) {
  const office = await riderOfficeOf(tx, input.riderId);
  if (!office) return null;
  const amount = share(input.payPiastres, office.commissionBp);
  return post(tx, {
    kind: 'rider_office_commission',
    idempotencyKey: `delivery:${input.deliveryId}:office_commission`,
    occurredAt: input.now,
    createdById: input.actorUserId,
    memo: input.memo,
    orderId: input.orderId,
    riderId: input.riderId,
    data: {
      supplierId: office.id,
      riderId: input.riderId,
      deliveryId: input.deliveryId,
      payPiastres: input.payPiastres,
      commissionBp: office.commissionBp,
    },
    lines: [
      { account: { type: 'rider_office_commission' }, amount },
      { account: { type: 'rider_office_accrued' }, amount: -amount },
    ],
  });
}

// ─── the office's terms ──────────────────────────────────────────────────────────

const validBp = (bp: number) => Number.isInteger(bp) && bp >= 0 && bp <= 10_000;

/**
 * Marks a supplier as a rider office (or not) and sets its commission (accounting manage,
 * audited). A new rate counts for deliveries from now on; earlier ones keep theirs. An office
 * with riders still linked cannot stop being one.
 */
export function setRiderOffice(
  db: Db,
  input: {
    supplierId: string;
    isRiderOffice?: boolean;
    commissionBp?: number;
    actorUserId: string;
  },
) {
  if (input.commissionBp !== undefined && !validBp(input.commissionBp))
    throw new DomainError('invalid_commission', 400);
  return inTransaction(db, async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!before) throw new DomainError('supplier_not_found', 404);
    const isRiderOffice = input.isRiderOffice ?? before.isRiderOffice;
    if (!isRiderOffice && before.isRiderOffice) {
      const linked = await tx.employee.count({
        where: { employment: 'outsourced', staffingSupplierId: before.id },
      });
      if (linked > 0) throw new DomainError('office_has_riders');
    }
    if (isRiderOffice && !before.isRiderOffice) {
      // Monthly staff hired through a company bill per person; an office is for riders only.
      const others = await tx.employee.count({
        where: {
          employment: 'outsourced',
          staffingSupplierId: before.id,
          payBasis: { not: 'per_delivery' },
        },
      });
      if (others > 0) throw new DomainError('supplier_has_staff');
    }
    const after = await tx.supplier.update({
      where: { id: before.id },
      data: { isRiderOffice, commissionBp: input.commissionBp ?? before.commissionBp },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.rider_office_update',
      entityType: 'supplier',
      entityId: before.id,
      before: { isRiderOffice: before.isRiderOffice, commissionBp: before.commissionBp },
      after: { isRiderOffice: after.isRiderOffice, commissionBp: after.commissionBp },
    });
    return after;
  });
}

/**
 * Who may be hired through a company: a rider office takes only riders paid per delivery, and
 * a rider paid per delivery is linked only to a rider office (HR file and hire wizard).
 */
export async function checkStaffingCompany(
  tx: Tx,
  input: { supplierId: string; role: string; payBasis: 'monthly_salary' | 'per_delivery' },
) {
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier || !supplier.isActive) throw new DomainError('supplier_not_found', 404);
  const perDeliveryRider = input.role === 'rider' && input.payBasis === 'per_delivery';
  if (supplier.isRiderOffice && !perDeliveryRider)
    throw new DomainError('rider_office_riders_only', 400);
  if (!supplier.isRiderOffice && perDeliveryRider)
    throw new DomainError('rider_office_required', 400);
  return supplier;
}

// ─── month end and the monthly bill ──────────────────────────────────────────────

/** Riders linked to an office (every status: a rider who left may still owe). */
async function officeRiders(db: Db, supplierId: string) {
  const people = await db.employee.findMany({
    where: { employment: 'outsourced', staffingSupplierId: supplierId },
    select: {
      id: true,
      nameEn: true,
      nameAr: true,
      status: true,
      user: {
        select: {
          id: true,
          name: true,
          rider: {
            select: {
              id: true,
              badgeCode: true,
              darkStoreId: true,
              darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
            },
          },
        },
      },
    },
    orderBy: { nameEn: 'asc' },
  });
  return people.filter((p) => p.user.rider);
}

/** Commission accrued for an office between two moments (credits on 2402, shown positive). */
async function accruedBetween(db: Db, supplierId: string, from: Date, to: Date) {
  const rows = await db.$queryRaw<{ amount: bigint | null; n: bigint; pay: bigint | null }[]>`
    SELECT -SUM(l.amount_piastres) AS amount, COUNT(*) AS n,
      SUM((e.data->>'payPiastres')::int) AS pay
    FROM ledger_lines l
      JOIN ledger_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
    WHERE a.key = 'rider_office_accrued' AND e.kind = 'rider_office_commission'
      AND e.data->>'supplierId' = ${supplierId}
      AND l.occurred_at >= ${from} AND l.occurred_at < ${to}`;
  const r = rows[0];
  return {
    commissionPiastres: Number(r?.amount ?? 0),
    deliveries: Number(r?.n ?? 0),
    payPiastres: Number(r?.pay ?? 0),
  };
}

/** Shortages moved onto an office for a month (by the month they were moved for). */
async function shortagesFor(db: Db, supplierId: string, month: string) {
  const rows = await db.$queryRaw<{ amount: bigint | null }[]>`
    SELECT SUM(l.amount_piastres) AS amount
    FROM ledger_lines l
      JOIN ledger_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
    WHERE e.kind = 'rider_office_shortage' AND a.type = 'supplier'
      AND e.data->>'supplierId' = ${supplierId} AND e.data->>'month' = ${month}`;
  return Number(rows[0]?.amount ?? 0);
}

/**
 * Month end for one rider of an office: what the rider still owed at the end of the month
 * beyond everything their wallet held then (owed − wallet, when above 0, and never more than
 * they owe now) moves onto the office. Once per rider and month.
 */
async function moveRiderShortage(
  tx: Tx,
  input: {
    supplierId: string;
    rider: { id: string; darkStoreId: string };
    month: string;
    at: Date;
    actorUserId: string;
  },
) {
  const key = `office_shortage:${input.rider.id}:${input.month}`;
  const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
  if (seen) return 0;
  const { to } = monthRange(input.month);
  const [duesAtEnd, walletAtEnd] = await Promise.all([
    balanceOf(tx, { type: 'rider_dues', riderId: input.rider.id }, to),
    balanceOf(tx, { type: 'rider_bonus', riderId: input.rider.id }, to),
  ]);
  const holds = 0 - walletAtEnd;
  const uncovered = duesAtEnd - Math.max(0, holds);
  if (uncovered <= 0) return 0;
  const now = await lockedBalance(tx, { type: 'rider_dues', riderId: input.rider.id });
  const amount = Math.min(uncovered, now.balance);
  if (amount <= 0) return 0;
  const entry = await post(tx, {
    kind: 'rider_office_shortage',
    idempotencyKey: key,
    occurredAt: input.at,
    createdById: input.actorUserId,
    memo: `Rider dues moved to the office ${input.month}`,
    riderId: input.rider.id,
    darkStoreId: input.rider.darkStoreId,
    data: {
      supplierId: input.supplierId,
      riderId: input.rider.id,
      month: input.month,
      duesPiastres: duesAtEnd,
      walletPiastres: holds,
    },
    lines: [
      { account: { type: 'supplier', supplierId: input.supplierId }, amount },
      { account: { type: 'rider_dues', riderId: input.rider.id }, amount: -amount },
    ],
  });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'finance.rider_office_shortage',
    entityType: 'rider',
    entityId: input.rider.id,
    before: { duesPiastres: duesAtEnd, walletPiastres: holds },
    after: {
      supplierId: input.supplierId,
      month: input.month,
      movedPiastres: amount,
      entry: entry?.number,
    },
  });
  return amount;
}

export type OfficeBillResult = {
  supplierId: string;
  name: string;
  month: string;
  status: 'billed' | 'already_billed' | 'nothing_to_bill' | 'refused';
  error?: string;
  billId?: string;
  billNumber?: number;
  commissionPiastres: number;
  vatPiastres: number;
  totalPiastres: number;
  shortagesPiastres: number;
};

async function prepareOne(
  db: Db,
  input: { supplierId: string; month: string; actorUserId: string; now: Date },
): Promise<OfficeBillResult> {
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rider_office:' + input.supplierId}))`;
    const office = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!office || !office.isRiderOffice) throw new DomainError('rider_office_not_found', 404);
    const { from, to } = monthRange(input.month);
    // Months are prepared in order: a later month's figures depend on this one's moves.
    const later = await tx.bill.findFirst({
      where: { supplierId: office.id, officeMonth: { gt: input.month } },
      select: { id: true },
    });
    const laterMove = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM ledger_entries
      WHERE kind = 'rider_office_shortage' AND data->>'supplierId' = ${office.id}
        AND data->>'month' > ${input.month}`;
    if (later || Number(laterMove[0]?.n ?? 0) > 0) throw new DomainError('later_month_prepared');

    // Dated on the month's last second, or now when the books are closed by then.
    const lock = await tx.booksLock.findUnique({ where: { id: 'books' } });
    const last = new Date(to.getTime() - 1000);
    const closed = !!lock && last < lock.lockedBefore;
    const at = closed ? input.now : last;
    const billDay = closed ? cairoDay(input.now) : lastDayOf(input.month);

    for (const person of await officeRiders(tx, office.id))
      await moveRiderShortage(tx, {
        supplierId: office.id,
        rider: { id: person.user.rider!.id, darkStoreId: person.user.rider!.darkStoreId },
        month: input.month,
        at,
        actorUserId: input.actorUserId,
      });
    const shortages = await shortagesFor(tx, office.id, input.month);
    const base = {
      supplierId: office.id,
      name: office.name,
      month: input.month,
      shortagesPiastres: shortages,
    };

    const existing = await tx.bill.findUnique({
      where: { supplierId_officeMonth: { supplierId: office.id, officeMonth: input.month } },
    });
    if (existing)
      return {
        ...base,
        status: 'already_billed' as const,
        billId: existing.id,
        billNumber: existing.number,
        commissionPiastres: existing.netPiastres,
        vatPiastres: existing.vatPiastres,
        totalPiastres: existing.totalPiastres,
      };
    const { commissionPiastres: net } = await accruedBetween(tx, office.id, from, to);
    if (net <= 0)
      return {
        ...base,
        status: 'nothing_to_bill' as const,
        commissionPiastres: 0,
        vatPiastres: 0,
        totalPiastres: 0,
      };
    // VAT on the commission only when the office is registered (has a tax number).
    const vat = office.taxId ? share(net, await getSetting(tx, 'fee.vat_bp')) : 0;
    const total = net + vat;
    const reference = `COMM-${input.month}`;
    const memo = `${office.name} rider commission ${input.month}`;
    const entry = await post(tx, {
      kind: 'supplier_bill',
      idempotencyKey: `bill:office_bill:${office.id}:${input.month}`,
      occurredAt: at,
      createdById: input.actorUserId,
      memo,
      data: {
        supplierId: office.id,
        reference,
        vat,
        userId: null,
        officeMonth: input.month,
        commissionPiastres: net,
      },
      lines: [
        { account: { type: 'rider_office_accrued' }, amount: net },
        { account: { type: 'vat_payable' }, amount: vat },
        { account: { type: 'supplier', supplierId: office.id }, amount: -total },
      ],
    });
    const accrued = await tx.ledgerAccount.findUniqueOrThrow({
      where: { key: 'rider_office_accrued' },
    });
    const bill = await tx.bill.create({
      data: {
        number: await nextNumber(tx, 'bills'),
        supplierId: office.id,
        reference,
        billDate: new Date(`${billDay}T00:00:00Z`),
        dueDate: new Date(`${cairoDay(input.now)}T00:00:00Z`),
        expenseAccountId: accrued.id,
        netPiastres: net,
        vatPiastres: vat,
        totalPiastres: total,
        whtBp: office.whtBp,
        memo,
        officeMonth: input.month,
        entryId: entry!.id,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bill_create',
      entityType: 'bill',
      entityId: bill.id,
      after: {
        number: bill.number,
        supplier: office.name,
        reference,
        total,
        officeMonth: input.month,
        shortages,
      },
    });
    return {
      ...base,
      status: 'billed' as const,
      billId: bill.id,
      billNumber: bill.number,
      commissionPiastres: net,
      vatPiastres: vat,
      totalPiastres: total,
    };
  });
}

/**
 * "Prepare office bills" (accounting use) once a Cairo month is over: for each rider office
 * (or one), the linked riders' uncovered dues move onto the office and one bill clears the
 * month's accrued commission (key office_bill:<supplier>:<month>; running again changes
 * nothing). No bill when nothing was accrued; shortages larger than the commission leave the
 * office's wallet in debit, carried into the next month. Never a negative bill.
 */
export async function prepareOfficeBills(
  db: Db,
  input: { month: string; supplierId?: string; actorUserId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  monthRange(input.month);
  if (input.month >= cairoDay(now).slice(0, 7)) throw new DomainError('month_not_over', 400);
  if (input.supplierId)
    return {
      month: input.month,
      offices: [await prepareOne(db, { ...input, supplierId: input.supplierId, now })],
    };
  const offices = await db.supplier.findMany({
    where: { isRiderOffice: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const results: OfficeBillResult[] = [];
  for (const o of offices) {
    try {
      results.push(await prepareOne(db, { ...input, supplierId: o.id, now }));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      results.push({
        supplierId: o.id,
        name: o.name,
        month: input.month,
        status: 'refused',
        error: error.code,
        commissionPiastres: 0,
        vatPiastres: 0,
        totalPiastres: 0,
        shortagesPiastres: 0,
      });
    }
  }
  return { month: input.month, offices: results };
}

// ─── screens ───────────────────────────────────────────────────────────────────

/** An office's wallet: what we owe it (positive) or it owes us (negative), and open bills. */
async function walletOf(db: Db, supplierId: string) {
  const [balance, open, accrued] = await Promise.all([
    balanceOf(db, { type: 'supplier', supplierId }),
    db.bill.aggregate({
      where: { supplierId, status: 'open' },
      _sum: { totalPiastres: true, paidPiastres: true },
      _count: { _all: true },
    }),
    db.$queryRaw<{ amount: bigint | null }[]>`
      SELECT -SUM(l.amount_piastres) AS amount
      FROM ledger_lines l
        JOIN ledger_entries e ON e.id = l.entry_id
        JOIN ledger_accounts a ON a.id = l.account_id
      WHERE a.key = 'rider_office_accrued' AND e.data->>'supplierId' = ${supplierId}`,
  ]);
  const openLeft = (open._sum.totalPiastres ?? 0) - (open._sum.paidPiastres ?? 0);
  return {
    /** What we owe the office now (negative: what it owes us) */
    owedPiastres: 0 - balance,
    openBills: open._count._all,
    openBillsPiastres: openLeft,
    /** What the office owes us beyond its open bills, set off when paying them */
    owesUsPiastres: Math.max(0, balance + openLeft),
    /** Commission accrued and not billed yet */
    unbilledPiastres: Number(accrued[0]?.amount ?? 0),
  };
}

/** Every rider office with this month's figures (Accounting > Money out > Rider offices). */
export async function listRiderOffices(db: Db, input: { month: string }) {
  const { from, to } = monthRange(input.month);
  const offices = await db.supplier.findMany({
    where: { isRiderOffice: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      taxId: true,
      whtBp: true,
      commissionBp: true,
      isActive: true,
      _count: {
        select: { staff: { where: { employment: 'outsourced', status: { not: 'left' } } } },
      },
    },
  });
  const rows = [];
  for (const o of offices) {
    const [month, shortages, wallet, bill] = await Promise.all([
      accruedBetween(db, o.id, from, to),
      shortagesFor(db, o.id, input.month),
      walletOf(db, o.id),
      db.bill.findUnique({
        where: { supplierId_officeMonth: { supplierId: o.id, officeMonth: input.month } },
        select: { id: true, number: true, status: true },
      }),
    ]);
    rows.push({
      id: o.id,
      name: o.name,
      taxId: o.taxId,
      whtBp: o.whtBp,
      commissionBp: o.commissionBp,
      isActive: o.isActive,
      riders: o._count.staff,
      deliveries: month.deliveries,
      riderPayPiastres: month.payPiastres,
      commissionPiastres: month.commissionPiastres,
      shortagesPiastres: shortages,
      bill,
      ...wallet,
    });
  }
  return { month: input.month, rows };
}

/** One office: its riders, the last 12 months, its bills and its wallet. */
export async function riderOfficeDetail(db: Db, input: { supplierId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const office = await db.supplier.findUnique({
    where: { id: input.supplierId },
    select: {
      id: true,
      name: true,
      taxId: true,
      phone: true,
      email: true,
      whtBp: true,
      commissionBp: true,
      isRiderOffice: true,
      isActive: true,
    },
  });
  if (!office || !office.isRiderOffice) throw new DomainError('rider_office_not_found', 404);
  const thisMonth = cairoDay(now).slice(0, 7);
  const first = addMonths(thisMonth, -11);
  const { from } = monthRange(first);
  const { to } = monthRange(thisMonth);

  const [people, commission, shortages, bills, wallet] = await Promise.all([
    officeRiders(db, office.id),
    db.$queryRaw<{ month: string; amount: bigint; n: bigint; pay: bigint | null }[]>`
      SELECT to_char(l.occurred_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo', 'YYYY-MM') AS month,
        -SUM(l.amount_piastres) AS amount, COUNT(*) AS n,
        SUM((e.data->>'payPiastres')::int) AS pay
      FROM ledger_lines l
        JOIN ledger_entries e ON e.id = l.entry_id
        JOIN ledger_accounts a ON a.id = l.account_id
      WHERE a.key = 'rider_office_accrued' AND e.kind = 'rider_office_commission'
        AND e.data->>'supplierId' = ${office.id}
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
      GROUP BY 1`,
    db.$queryRaw<{ month: string; amount: bigint }[]>`
      SELECT e.data->>'month' AS month, SUM(l.amount_piastres) AS amount
      FROM ledger_lines l
        JOIN ledger_entries e ON e.id = l.entry_id
        JOIN ledger_accounts a ON a.id = l.account_id
      WHERE e.kind = 'rider_office_shortage' AND a.type = 'supplier'
        AND e.data->>'supplierId' = ${office.id}
      GROUP BY 1`,
    db.bill.findMany({
      where: { supplierId: office.id },
      orderBy: { number: 'desc' },
      take: 50,
      select: {
        id: true,
        number: true,
        reference: true,
        officeMonth: true,
        billDate: true,
        netPiastres: true,
        vatPiastres: true,
        totalPiastres: true,
        paidPiastres: true,
        status: true,
      },
    }),
    walletOf(db, office.id),
  ]);
  // This month's figures per rider: deliveries and commission, what they owe and hold now.
  const { from: monthFrom } = monthRange(thisMonth);
  const perRider = await db.$queryRaw<{ rider_id: string; amount: bigint; n: bigint }[]>`
    SELECT e.data->>'riderId' AS rider_id, -SUM(l.amount_piastres) AS amount, COUNT(*) AS n
    FROM ledger_lines l
      JOIN ledger_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
    WHERE a.key = 'rider_office_accrued' AND e.kind = 'rider_office_commission'
      AND e.data->>'supplierId' = ${office.id} AND l.occurred_at >= ${monthFrom}
    GROUP BY 1`;
  const riders = [];
  for (const p of people) {
    const r = p.user.rider!;
    const [dues, held] = await Promise.all([
      balanceOf(db, { type: 'rider_dues', riderId: r.id }),
      balanceOf(db, { type: 'rider_bonus', riderId: r.id }),
    ]);
    const mine = perRider.find((x) => x.rider_id === r.id);
    riders.push({
      employeeId: p.id,
      userId: p.user.id,
      riderId: r.id,
      name: p.user.name,
      nameAr: p.nameAr,
      badgeCode: r.badgeCode,
      status: p.status,
      darkStore: r.darkStore,
      deliveriesThisMonth: Number(mine?.n ?? 0),
      commissionThisMonthPiastres: Number(mine?.amount ?? 0),
      owesPiastres: dues,
      walletPiastres: 0 - held,
    });
  }
  const months = [];
  for (let i = 0; i < 12; i++) {
    const m = addMonths(thisMonth, -i);
    const c = commission.find((x) => x.month === m);
    const bill = bills.find((b) => b.officeMonth === m) ?? null;
    months.push({
      month: m,
      over: m < thisMonth,
      deliveries: Number(c?.n ?? 0),
      riderPayPiastres: Number(c?.pay ?? 0),
      commissionPiastres: Number(c?.amount ?? 0),
      shortagesPiastres: Number(shortages.find((x) => x.month === m)?.amount ?? 0),
      bill: bill ? { id: bill.id, number: bill.number, status: bill.status } : null,
    });
  }
  return {
    office,
    wallet,
    riders,
    months,
    bills: bills.map((b) => ({
      ...b,
      billDate: b.billDate.toISOString().slice(0, 10),
      leftPiastres: b.status === 'open' ? b.totalPiastres - b.paidPiastres : 0,
    })),
  };
}

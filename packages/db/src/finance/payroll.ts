import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  isCalendarDay,
  monthlyPayslip,
  type PayrollRules,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { employmentOf, packageGross, packageInForce } from '../hr-pay';
import { type HrPayItem, hrPayrollItems, markHrPayrollItems } from '../hr-inbox';
import { markCommissionsPaid, payableCommissions } from '../crm-sales';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { balanceOf, post } from './ledger';
import { getSetting } from '../settings';
import { eventTime } from './books';

type Tx = Prisma.TransactionClient;

// Salaries and staff advances. HR keeps each person's salary package (basic plus allowances,
// docs/HR.md); Accounting reads the package in force and pays it, it never edits people.
// An advance is money given early, kept in the person's advance wallet (1500-xxxx) and
// recovered from a salary. The month's salary run pays everyone in one entry:
//
//   salaries expense (gross − penalties, tagged with the person and their store)
//   + social insurance, company share
//     = income tax + social insurance (both shares) + martyrs fund owed to the state
//     + staff advance recovered (back from their wallet) + net paid from a bank or box
//
// Only employees paid a monthly salary are on the payroll: riders paid per delivered order earn
// through the rider wallet (rider-wallet.ts), untaxed. People hired through an outsourcing company are paid
// by that company: their month is a supplier bill (see payables), and we only give them
// advances and bonuses directly.

const STAFF_ROLES = ['admin', 'finance', 'store_staff', 'rider'] as const;
const MONEY_GROUPS = [1100, 1200];

/** The salary deduction rules, from the settings (the law changes every year or two). */
export async function payrollRules(db: Db): Promise<PayrollRules> {
  const g = (key: Parameters<typeof getSetting>[1]) => getSetting(db, key);
  const bands = [];
  for (const n of [1, 2, 3, 4, 5, 6] as const)
    bands.push({
      to: await g(`payroll.tax_band_${n}_to_piastres`),
      bp: await g(`payroll.tax_band_${n}_bp`),
    });
  const skipFrom = [];
  for (const n of [1, 2, 3, 4, 5] as const)
    skipFrom.push(await g(`payroll.tax_skip_${n}_from_piastres`));
  return {
    bands,
    topBp: await g('payroll.tax_top_bp'),
    skipFrom,
    personalExemption: await g('payroll.personal_exemption_piastres'),
    siEmployeeBp: await g('payroll.si_employee_bp'),
    siEmployerBp: await g('payroll.si_employer_bp'),
    siMinWage: await g('payroll.si_min_wage_piastres'),
    siMaxWage: await g('payroll.si_max_wage_piastres'),
    martyrsBp: await g('payroll.martyrs_fund_bp'),
  };
}

/**
 * Every active team member with the salary package HR keeps for them (in force today), their
 * store and the advance they still owe. Read only: HR edits people, Accounting pays them.
 */
export async function listStaffPay(db: Db) {
  // Riders paid per delivered order are never on the salary run (CLAUDE.md "Rider pay").
  const users = await db.user.findMany({
    where: {
      role: { in: [...STAFF_ROLES] },
      isActive: true,
      OR: [{ employee: null }, { employee: { payBasis: 'monthly_salary' } }],
    },
    include: {
      employee: {
        select: {
          id: true,
          number: true,
          nationalId: true,
          socialInsuranceNumber: true,
          employment: true,
          staffingSupplier: { select: { id: true, name: true } },
          department: { select: { id: true, nameEn: true, nameAr: true } },
          position: { select: { id: true, titleEn: true, titleAr: true } },
          grade: { select: { id: true, nameEn: true, nameAr: true } },
        },
      },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      rider: { select: { id: true, darkStoreId: true } },
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  const advances = await db.ledgerAccount.findMany({
    where: { type: 'staff_advance', userId: { in: users.map((u) => u.id) } },
    select: { id: true, userId: true },
  });
  const sums = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: advances.map((a) => a.id) } },
    _sum: { amountPiastres: true },
  });
  const today = cairoDay(new Date());
  const rows = [];
  for (const u of users) {
    const wallet = advances.find((a) => a.userId === u.id);
    const pkg = u.employee ? await packageInForce(db, u.employee.id, today) : null;
    rows.push({
      userId: u.id,
      employeeId: u.employee?.id ?? null,
      name: u.name,
      role: u.role,
      darkStore: u.darkStore,
      department: u.employee?.department ?? null,
      position: u.employee?.position ?? null,
      grade: u.employee?.grade ?? null,
      employment: u.employee?.employment ?? ('employee' as const),
      staffingSupplier: u.employee?.staffingSupplier ?? null,
      /** The gross of the package in force today (basic plus allowances) */
      monthlyPiastres: pkg ? packageGross(pkg) : null,
      basicPiastres: pkg?.basicPiastres ?? null,
      allowancesPiastres: pkg ? packageGross(pkg) - pkg.basicPiastres : null,
      packageFrom: pkg ? pkg.effectiveFrom.toISOString().slice(0, 10) : null,
      insuredWagePiastres: pkg?.insuredWagePiastres ?? null,
      nationalId: u.employee?.nationalId ?? null,
      insuranceNumber: u.employee?.socialInsuranceNumber ?? null,
      advanceOwedPiastres: wallet
        ? (sums.find((s) => s.accountId === wallet.id)?._sum.amountPiastres ?? 0)
        : 0,
    });
  }
  return rows;
}

async function moneyAccount(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_accounts WHERE id = ${id} FOR UPDATE`;
  const account = rows.length ? await tx.ledgerAccount.findUnique({ where: { id } }) : null;
  if (!account || !MONEY_GROUPS.includes(account.groupCode))
    throw new DomainError('account_not_found', 404);
  if (!account.isActive) throw new DomainError('account_inactive');
  return account;
}

/** Where a person's pay counts: their store, and the rider record for riders. */
async function personTags(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { rider: { select: { id: true, darkStoreId: true } } },
  });
  if (!user || user.role === 'merchant') throw new DomainError('user_not_found', 404);
  return {
    user,
    tags: {
      userId: user.id,
      darkStoreId: user.darkStoreId ?? user.rider?.darkStoreId ?? null,
      riderId: user.rider?.id ?? null,
    },
  };
}

export interface AdvanceInput {
  userId: string;
  amountPiastres: number;
  moneyAccountId: string;
  reference: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/** Money given to a team member early; they owe it until a salary recovers it. */
export function giveAdvance(db: Db, input: AdvanceInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `advance:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const money = await moneyAccount(tx, input.moneyAccountId);
    const { user, tags } = await personTags(tx, input.userId);
    if (input.amountPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const entry = await post(tx, {
      kind: 'staff_advance',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.reference,
      darkStoreId: tags.darkStoreId,
      riderId: tags.riderId,
      data: { userId: user.id, reference: input.reference },
      lines: [
        {
          account: { type: 'staff_advance', userId: user.id },
          amount: input.amountPiastres,
          tags,
        },
        { account: { id: money.id }, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.staff_advance',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: { userId: user.id, amount: input.amountPiastres, from: money.code },
    });
    return entry!;
  });
}

export interface PayrollInput {
  /** YYYY-MM */
  month: string;
  moneyAccountId: string;
  /** Everyone paid this month; gross comes from their salary unless given */
  lines: {
    userId: string;
    grossPiastres?: number;
    /** Taxed with the salary (overtime, a target bonus) */
    bonusPiastres?: number;
    /** Penalties or unpaid days, taken off before tax */
    deductionPiastres?: number;
    advanceRecoveryPiastres?: number;
    note?: string;
  }[];
  actorUserId: string;
  /** Kept for the approval flow; the run itself is once per month */
  idempotencyKey?: string;
}

/** The last day of a month YYYY-MM. */
function monthEnd(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** What the month's run would pay each person, checked, before anything is posted. */
export async function previewPayroll(db: Db, input: Omit<PayrollInput, 'actorUserId'>) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new DomainError('invalid_month', 400);
  // The current month may be paid while it runs (salaries are paid at its end, dated now);
  // a month that has not started cannot.
  if (input.month > cairoDay(new Date()).slice(0, 7)) throw new DomainError('future_month', 400);
  if (input.lines.length === 0) throw new DomainError('nothing_to_pay', 400);
  if (new Set(input.lines.map((l) => l.userId)).size !== input.lines.length)
    throw new DomainError('person_twice', 400);
  const rules = await payrollRules(db);
  const rows: (Omit<PayslipRow, 'note'> & {
    tags: Awaited<ReturnType<typeof personTags>>['tags'];
    note?: string;
    /** Approved sales commission paid with this salary (docs/SALES.md 11) */
    commissionIds: string[];
    hrPayItems: HrPayItem[];
  })[] = [];
  for (const l of input.lines) {
    const { user, tags } = await personTags(db as Tx, l.userId);
    const file = await employmentOf(db, user.id);
    if (file.employment === 'outsourced') throw new DomainError('outsourced_not_on_payroll', 400);
    if (file.payBasis === 'per_delivery') throw new DomainError('per_delivery_not_on_payroll', 400);
    // The package HR keeps in force on the month's last day (basic plus allowances).
    const salary = file.id ? await packageInForce(db, file.id, monthEnd(input.month)) : null;
    const base = l.grossPiastres ?? (salary ? packageGross(salary) : undefined);
    if (base === undefined) throw new DomainError('salary_not_set', 400);
    const bonus = l.bonusPiastres ?? 0;
    const deduction = l.deductionPiastres ?? 0;
    const recovery = l.advanceRecoveryPiastres ?? 0;
    for (const v of [base, bonus, deduction, recovery])
      if (!Number.isSafeInteger(v) || v < 0) throw new DomainError('invalid_amount', 400);
    // Sales commission approved by the sales manager comes in by itself, taxed with the salary;
    // Accounting reads it and never changes it.
    const commissions = await payableCommissions(db, user.id, input.month);
    const commission = commissions.reduce((s, c) => s + c.amountPiastres, 0);
    // HR phase 3: unpaid leave days and final violation deductions not taken yet reduce the
    // gross before tax (a day of pay is the basic over hr.payroll_days_per_month).
    const hr = file.id
      ? await hrPayrollItems(db, {
          employeeId: file.id,
          monthEnd: monthEnd(input.month),
          basicPiastres: salary?.basicPiastres ?? base,
        })
      : { items: [], totalPiastres: 0 };
    const gross = base + bonus + commission - deduction - hr.totalPiastres;
    if (gross < 0) throw new DomainError('net_below_zero', 400);
    const slip = monthlyPayslip({ gross, insuredWage: salary?.insuredWagePiastres ?? null }, rules);
    const owed = await balanceOf(db, { type: 'staff_advance', userId: user.id });
    if (recovery > owed) throw new DomainError('more_than_advance', 400);
    const net = slip.afterTax - recovery;
    if (net < 0) throw new DomainError('net_below_zero', 400);
    // The package's parts, shown on the payslip (only when the run used the package's gross).
    const fromPackage = salary && l.grossPiastres === undefined;
    rows.push({
      userId: user.id,
      name: user.name,
      tags,
      base,
      basic: fromPackage ? salary.basicPiastres : null,
      allowances: fromPackage
        ? salary.allowances.map((a) => ({
            kind: a.kind,
            label: a.label,
            amountPiastres: a.amountPiastres,
          }))
        : [],
      bonus,
      commission,
      commissionIds: commissions.map((c) => c.id),
      deduction,
      hrDeduction: hr.totalPiastres,
      hrItems: hr.items.map((i) => ({
        kind: i.kind,
        label: i.label,
        days: i.days,
        amountPiastres: i.amountPiastres,
      })),
      hrPayItems: hr.items,
      gross,
      insuredWage: slip.insuredWage,
      siEmployee: slip.siEmployee,
      siEmployer: slip.siEmployer,
      martyrs: slip.martyrs,
      incomeTax: slip.incomeTax,
      recovery,
      net,
      note: l.note,
    });
  }
  const sum = (k: 'net' | 'gross' | 'siEmployer' | 'incomeTax' | 'siEmployee' | 'martyrs') =>
    rows.reduce((s, r) => s + r[k], 0);
  return {
    month: input.month,
    rows,
    totalNetPiastres: sum('net'),
    totalCostPiastres: sum('gross') + sum('siEmployer'),
    totalIncomeTaxPiastres: sum('incomeTax'),
    totalSocialInsurancePiastres: sum('siEmployee') + sum('siEmployer'),
    totalMartyrsPiastres: sum('martyrs'),
  };
}

/**
 * Pays the month's salaries from one bank or cash box, once per month: the salaries
 * expense per person (tagged with them and their store), advances recovered, net paid.
 */
export function runPayroll(db: Db, input: PayrollInput) {
  return inTransaction(db, async (tx) => {
    const key = `payroll:${input.month}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) throw new DomainError('payroll_already_run');
    const plan = await previewPayroll(tx, input);
    const money = await moneyAccount(tx, input.moneyAccountId);
    if (plan.totalNetPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const salaries = await tx.ledgerAccount.findUnique({ where: { key: 'expense:salaries' } });
    if (!salaries) throw new DomainError('expense_account_not_found', 404);
    // The last day of the month, or now when the month is still running.
    const [y, m] = input.month.split('-').map(Number) as [number, number];
    const lastDay = `${input.month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const at =
      lastDay < cairoDay(new Date())
        ? new Date(cairoDayStart(addDays(lastDay, 1)).getTime() - 3600_000)
        : new Date();
    if (!isCalendarDay(lastDay)) throw new DomainError('invalid_month', 400);
    const lines: Parameters<typeof post>[1]['lines'] = [];
    for (const r of plan.rows) {
      lines.push({ account: { id: salaries.id }, amount: r.gross, tags: r.tags });
      lines.push({
        account: { type: 'social_insurance_expense' },
        amount: r.siEmployer,
        tags: r.tags,
      });
      lines.push({
        account: { type: 'staff_advance', userId: r.userId },
        amount: -r.recovery,
        tags: r.tags,
      });
    }
    lines.push({ account: { type: 'payroll_tax_payable' }, amount: -plan.totalIncomeTaxPiastres });
    lines.push({
      account: { type: 'social_insurance_payable' },
      amount: -plan.totalSocialInsurancePiastres,
    });
    lines.push({ account: { type: 'martyrs_fund_payable' }, amount: -plan.totalMartyrsPiastres });
    lines.push({ account: { id: money.id }, amount: -plan.totalNetPiastres });
    const entry = await post(tx, {
      kind: 'payroll',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `Salaries ${input.month}`,
      data: {
        month: input.month,
        people: plan.rows.map((r) => ({
          userId: r.userId,
          name: r.name,
          base: r.base,
          basic: r.basic,
          allowances: r.allowances,
          bonus: r.bonus,
          commission: r.commission,
          deduction: r.deduction,
          hrDeduction: r.hrDeduction,
          hrItems: r.hrItems,
          gross: r.gross,
          insuredWage: r.insuredWage,
          siEmployee: r.siEmployee,
          siEmployer: r.siEmployer,
          martyrs: r.martyrs,
          incomeTax: r.incomeTax,
          recovery: r.recovery,
          net: r.net,
          note: r.note ?? null,
        })),
      },
      lines,
    });
    if (!entry) throw new DomainError('nothing_to_pay', 400);
    for (const r of plan.rows) await markHrPayrollItems(tx, r.hrPayItems, entry.id);
    await markCommissionsPaid(
      tx,
      plan.rows.flatMap((r) => r.commissionIds),
      'payroll',
      entry.id,
      at,
    );
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payroll',
      entityType: 'ledger_entry',
      entityId: entry.id,
      after: { month: input.month, people: plan.rows.length, net: plan.totalNetPiastres },
    });
    return entry;
  });
}

export interface PayslipRow {
  userId: string;
  name: string;
  base: number;
  /** The basic salary of the package the run used (null: older runs or a gross typed in) */
  basic: number | null;
  /** The package's allowances (housing, transport...) included in base */
  allowances: { kind: string; label: string | null; amountPiastres: number }[];
  bonus: number;
  /** Sales commission paid with the salary */
  commission: number;
  deduction: number;
  /** Unpaid leave and final violation deductions from HR (phase 3), before tax */
  hrDeduction: number;
  hrItems: { kind: string; label: string; days: number | null; amountPiastres: number }[];
  gross: number;
  insuredWage: number;
  siEmployee: number;
  siEmployer: number;
  martyrs: number;
  incomeTax: number;
  recovery: number;
  net: number;
  note: string | null;
}

/** The payslips of a month's salary run (empty before the run). */
export async function payslips(db: Db, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError('invalid_month', 400);
  const entry = await db.ledgerEntry.findUnique({ where: { idempotencyKey: `payroll:${month}` } });
  if (!entry) return { month, entryNumber: null, paidAt: null, people: [] as PayslipRow[] };
  const data = entry.data as { people?: PayslipRow[] };
  return {
    month,
    entryNumber: entry.number,
    paidAt: entry.occurredAt,
    people: (data.people ?? []).map((p) => ({
      ...p,
      name: p.name ?? '',
      base: p.base ?? p.gross,
      basic: p.basic ?? null,
      allowances: p.allowances ?? [],
      bonus: p.bonus ?? 0,
      commission: p.commission ?? 0,
      hrDeduction: p.hrDeduction ?? 0,
      hrItems: p.hrItems ?? [],
      insuredWage: p.insuredWage ?? 0,
      siEmployee: p.siEmployee ?? 0,
      siEmployer: p.siEmployer ?? 0,
      martyrs: p.martyrs ?? 0,
      incomeTax: p.incomeTax ?? 0,
    })),
  };
}

/**
 * Where a month's salary run stands: paid (its entry), waiting for a second person (its
 * request), or not run yet. The run screen shows a paid month as Paid with its entry and no
 * pay button; paying it again would only answer the first run.
 */
export async function payrollRunStatus(db: Db, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError('invalid_month', 400);
  const [entry, request] = await Promise.all([
    db.ledgerEntry.findUnique({
      where: { idempotencyKey: `payroll:${month}` },
      select: { id: true, number: true, occurredAt: true },
    }),
    db.financeRequest.findFirst({
      where: {
        kind: 'payroll',
        status: 'pending',
        payload: { path: ['input', 'month'], equals: month },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return {
    month,
    status: entry ? ('paid' as const) : request ? ('pending' as const) : ('open' as const),
    entryId: entry?.id ?? null,
    entryNumber: entry?.number ?? null,
    paidAt: entry?.occurredAt ?? null,
    requestId: entry ? null : (request?.id ?? null),
  };
}

export interface BonusInput {
  userId: string;
  amountPiastres: number;
  /** An approved sales commission this bonus pays (docs/SALES.md 11) */
  commissionId?: string;
  moneyAccountId: string;
  reference: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/**
 * A bonus paid straight to an outsourced person (their salary comes from the outsourcing
 * company). Employees get bonuses through the salary run, where they are taxed.
 */
export function payStaffBonus(db: Db, input: BonusInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `staff_bonus:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const money = await moneyAccount(tx, input.moneyAccountId);
    const { user, tags } = await personTags(tx, input.userId);
    if ((await employmentOf(tx, user.id)).employment !== 'outsourced')
      throw new DomainError('employee_bonus_in_payroll');
    if (input.amountPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    if (input.commissionId) {
      const c = await tx.crmCommission.findUnique({ where: { id: input.commissionId } });
      if (
        !c ||
        c.userId !== user.id ||
        c.status !== 'approved' ||
        c.paidEntryId ||
        c.amountPiastres !== input.amountPiastres
      )
        throw new DomainError('commission_not_payable');
    }
    const entry = await post(tx, {
      kind: 'staff_bonus',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.reference,
      darkStoreId: tags.darkStoreId,
      riderId: tags.riderId,
      data: {
        userId: user.id,
        reference: input.reference,
        ...(input.commissionId && { commissionId: input.commissionId }),
      },
      lines: [
        { account: { type: 'staff_bonus_expense' }, amount: input.amountPiastres, tags },
        { account: { id: money.id }, amount: -input.amountPiastres },
      ],
    });
    if (input.commissionId)
      await markCommissionsPaid(tx, [input.commissionId], 'bonus', entry!.id, at);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.staff_bonus',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: { userId: user.id, amount: input.amountPiastres, from: money.code },
    });
    return entry!;
  });
}

/**
 * My HR: a person's own payslips, newest month first. A payslip exists only once the month's
 * salary run is posted (a run waiting for a second person has no entry yet). Each carries the
 * bank or cash box the run was paid from.
 */
export async function myPayslips(db: Db, userId: string) {
  const match = JSON.stringify([{ userId }]);
  const entries = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_entries
    WHERE kind = 'payroll' AND idempotency_key LIKE 'payroll:%'
      AND data->'people' @> ${match}::jsonb
    ORDER BY occurred_at DESC`;
  if (!entries.length) return [];
  const rows = await db.ledgerEntry.findMany({
    where: { id: { in: entries.map((e) => e.id) } },
    include: {
      lines: {
        where: { amountPiastres: { lt: 0 }, account: { groupCode: { in: MONEY_GROUPS } } },
        include: {
          account: { select: { id: true, code: true, nameEn: true, nameAr: true, type: true } },
        },
      },
    },
  });
  const slips = [];
  for (const e of rows) {
    const month = e.idempotencyKey.slice('payroll:'.length);
    const run = await payslips(db, month);
    const person = run.people.find((p) => p.userId === userId);
    if (!person) continue;
    const from = e.lines[0]?.account ?? null;
    slips.push({
      month,
      entryNumber: e.number,
      paidAt: e.occurredAt,
      paidFrom: from && {
        code: from.code,
        type: from.type,
        nameEn: from.nameEn ?? from.code,
        nameAr: from.nameAr ?? from.nameEn ?? from.code,
      },
      ...person,
    });
  }
  return slips.sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** One of my payslips by month, or a 404 when there is none (not posted, or not mine). */
export async function myPayslip(db: Db, userId: string, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError('invalid_month', 400);
  const slip = (await myPayslips(db, userId)).find((s) => s.month === month);
  if (!slip) throw new DomainError('payslip_not_found', 404);
  return slip;
}

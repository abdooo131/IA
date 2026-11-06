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
import { ensureEmployee, syncEmployment } from '../hr';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { balanceOf, post } from './ledger';
import { getSetting } from '../settings';
import { eventTime } from './books';

type Tx = Prisma.TransactionClient;

// Salaries and staff advances. Each team member has a monthly salary (gross) set by admin.
// An advance is money given early, kept in the person's advance wallet (1500-xxxx) and
// recovered from a salary. The month's salary run pays everyone in one entry:
//
//   salaries expense (gross − penalties, tagged with the person and their store)
//   + social insurance, company share
//     = income tax + social insurance (both shares) + martyrs fund owed to the state
//     + staff advance recovered (back from their wallet) + net paid from a bank or box
//
// Only employees are on the payroll. People hired through an outsourcing company are paid
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

/** Sets an employee's monthly salary (gross, piastres) and insured wage. Admin only. */
export async function setSalary(
  db: Db,
  input: {
    userId: string;
    monthlyPiastres: number;
    insuredWagePiastres?: number | null;
    nationalId?: string | null;
    insuranceNumber?: string | null;
    actorUserId: string;
  },
) {
  if (!Number.isSafeInteger(input.monthlyPiastres) || input.monthlyPiastres < 0)
    throw new DomainError('invalid_amount', 400);
  if (input.nationalId && !/^\d{14}$/.test(input.nationalId))
    throw new DomainError('invalid_national_id', 400);
  if (
    input.insuredWagePiastres != null &&
    (!Number.isSafeInteger(input.insuredWagePiastres) || input.insuredWagePiastres < 0)
  )
    throw new DomainError('invalid_amount', 400);
  return inTransaction(db, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.role === 'merchant') throw new DomainError('user_not_found', 404);
    if (user.employment === 'outsourced') throw new DomainError('outsourced_not_on_payroll');
    const before = await tx.staffSalary.findUnique({ where: { userId: user.id } });
    const insured = input.insuredWagePiastres === undefined ? undefined : input.insuredWagePiastres;
    await tx.staffSalary.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        monthlyPiastres: input.monthlyPiastres,
        insuredWagePiastres: insured ?? null,
        updatedById: input.actorUserId,
      },
      update: {
        monthlyPiastres: input.monthlyPiastres,
        insuredWagePiastres: insured,
        updatedById: input.actorUserId,
      },
    });
    // The national ID and insurance number live on the employee file (docs/HR.md).
    if (input.nationalId !== undefined || input.insuranceNumber !== undefined) {
      const file = await ensureEmployee(tx, user.id);
      if (file) {
        const ids = {
          nationalId: input.nationalId === undefined ? file.nationalId : input.nationalId,
          socialInsuranceNumber:
            input.insuranceNumber === undefined
              ? file.socialInsuranceNumber
              : input.insuranceNumber,
        };
        if (
          ids.nationalId !== file.nationalId ||
          ids.socialInsuranceNumber !== file.socialInsuranceNumber
        ) {
          await tx.employee.update({ where: { id: file.id }, data: ids });
          await recordAudit(tx, {
            actorUserId: input.actorUserId,
            action: 'employee.update',
            entityType: 'employee',
            entityId: file.id,
            before: {
              nationalId: file.nationalId,
              socialInsuranceNumber: file.socialInsuranceNumber,
            },
            after: ids,
          });
        }
      }
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.salary_set',
      entityType: 'user',
      entityId: user.id,
      before: {
        monthlyPiastres: before?.monthlyPiastres ?? null,
        insuredWagePiastres: before?.insuredWagePiastres ?? null,
      },
      after: { monthlyPiastres: input.monthlyPiastres, insuredWagePiastres: insured ?? null },
    });
    return { userId: user.id, monthlyPiastres: input.monthlyPiastres };
  });
}

/** Every active team member with their salary, store and the advance they still owe. */
export async function listStaffPay(db: Db) {
  const users = await db.user.findMany({
    where: { role: { in: [...STAFF_ROLES] }, isActive: true },
    include: {
      salary: true,
      employee: { select: { nationalId: true, socialInsuranceNumber: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      rider: { select: { id: true, darkStoreId: true } },
      staffingSupplier: { select: { id: true, name: true } },
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
  return users.map((u) => {
    const wallet = advances.find((a) => a.userId === u.id);
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      darkStore: u.darkStore,
      employment: u.employment,
      staffingSupplier: u.staffingSupplier,
      monthlyPiastres: u.salary?.monthlyPiastres ?? null,
      insuredWagePiastres: u.salary?.insuredWagePiastres ?? null,
      nationalId: u.employee?.nationalId ?? null,
      insuranceNumber: u.employee?.socialInsuranceNumber ?? null,
      advanceOwedPiastres: wallet
        ? (sums.find((s) => s.accountId === wallet.id)?._sum.amountPiastres ?? 0)
        : 0,
    };
  });
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

/** What the month's run would pay each person, checked, before anything is posted. */
export async function previewPayroll(db: Db, input: Omit<PayrollInput, 'actorUserId'>) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new DomainError('invalid_month', 400);
  if (input.lines.length === 0) throw new DomainError('nothing_to_pay', 400);
  if (new Set(input.lines.map((l) => l.userId)).size !== input.lines.length)
    throw new DomainError('person_twice', 400);
  const rules = await payrollRules(db);
  const rows: (Omit<PayslipRow, 'note'> & {
    tags: Awaited<ReturnType<typeof personTags>>['tags'];
    note?: string;
  })[] = [];
  for (const l of input.lines) {
    const { user, tags } = await personTags(db as Tx, l.userId);
    if (user.employment === 'outsourced') throw new DomainError('outsourced_not_on_payroll', 400);
    const salary = await db.staffSalary.findUnique({ where: { userId: user.id } });
    const base = l.grossPiastres ?? salary?.monthlyPiastres;
    if (base === undefined) throw new DomainError('salary_not_set', 400);
    const bonus = l.bonusPiastres ?? 0;
    const deduction = l.deductionPiastres ?? 0;
    const recovery = l.advanceRecoveryPiastres ?? 0;
    for (const v of [base, bonus, deduction, recovery])
      if (!Number.isSafeInteger(v) || v < 0) throw new DomainError('invalid_amount', 400);
    const gross = base + bonus - deduction;
    if (gross < 0) throw new DomainError('net_below_zero', 400);
    const slip = monthlyPayslip({ gross, insuredWage: salary?.insuredWagePiastres ?? null }, rules);
    const owed = await balanceOf(db, { type: 'staff_advance', userId: user.id });
    if (recovery > owed) throw new DomainError('more_than_advance', 400);
    const net = slip.afterTax - recovery;
    if (net < 0) throw new DomainError('net_below_zero', 400);
    rows.push({
      userId: user.id,
      name: user.name,
      tags,
      base,
      bonus,
      deduction,
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
          bonus: r.bonus,
          deduction: r.deduction,
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
  bonus: number;
  deduction: number;
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
      bonus: p.bonus ?? 0,
      insuredWage: p.insuredWage ?? 0,
      siEmployee: p.siEmployee ?? 0,
      siEmployer: p.siEmployer ?? 0,
      martyrs: p.martyrs ?? 0,
      incomeTax: p.incomeTax ?? 0,
    })),
  };
}

export interface BonusInput {
  userId: string;
  amountPiastres: number;
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
    if (user.employment !== 'outsourced') throw new DomainError('employee_bonus_in_payroll');
    if (input.amountPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const entry = await post(tx, {
      kind: 'staff_bonus',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.reference,
      darkStoreId: tags.darkStoreId,
      riderId: tags.riderId,
      data: { userId: user.id, reference: input.reference },
      lines: [
        { account: { type: 'staff_bonus_expense' }, amount: input.amountPiastres, tags },
        { account: { id: money.id }, amount: -input.amountPiastres },
      ],
    });
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

/** Marks a team member as an employee or as hired through an outsourcing company. Admin only. */
export function setEmployment(
  db: Db,
  input: {
    userId: string;
    employment: 'employee' | 'outsourced';
    staffingSupplierId?: string | null;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.role === 'merchant') throw new DomainError('user_not_found', 404);
    const supplierId =
      input.employment === 'outsourced' ? (input.staffingSupplierId ?? null) : null;
    if (input.employment === 'outsourced') {
      if (!supplierId) throw new DomainError('staffing_company_required', 400);
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier || !supplier.isActive) throw new DomainError('supplier_not_found', 404);
      // Someone paid by an outsourcing company has no salary of ours.
      await tx.staffSalary.deleteMany({ where: { userId: user.id } });
    }
    const after = await tx.user.update({
      where: { id: user.id },
      data: { employment: input.employment, staffingSupplierId: supplierId },
    });
    await syncEmployment(tx, user.id, input.employment === 'outsourced');
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.employment_set',
      entityType: 'user',
      entityId: user.id,
      before: { employment: user.employment, staffingSupplierId: user.staffingSupplierId },
      after: { employment: after.employment, staffingSupplierId: after.staffingSupplierId },
    });
    return { userId: user.id, employment: after.employment, staffingSupplierId: supplierId };
  });
}

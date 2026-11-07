import type { Prisma } from '@prisma/client';
import { cairoDay, type Employment, type SalaryPackageBody } from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { ensureEmployee } from './hr';

// HR v2 (docs/HR.md): HR owns employment (on our payroll or through an outsourcing company) and
// the salary package (basic plus allowances, from a day on, with history). Accounting reads the
// package in force to run payroll and never edits people.

type Tx = Prisma.TransactionClient;

const day = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (d: string) => new Date(`${d}T00:00:00Z`);

const packageInclude = {
  allowances: { orderBy: { id: 'asc' } },
  createdBy: { select: { id: true, name: true } },
} as const;
type PackageRow = Prisma.SalaryPackageGetPayload<{ include: typeof packageInclude }>;

/** Basic plus every allowance: what payroll takes as the month's gross. */
export function packageGross(p: {
  basicPiastres: number;
  allowances: { amountPiastres: number }[];
}) {
  return p.basicPiastres + p.allowances.reduce((s, a) => s + a.amountPiastres, 0);
}

function packageView(p: PackageRow, current: boolean) {
  return {
    id: p.id,
    effectiveFrom: day(p.effectiveFrom),
    basicPiastres: p.basicPiastres,
    insuredWagePiastres: p.insuredWagePiastres,
    allowances: p.allowances.map((a) => ({
      kind: a.kind,
      label: a.label,
      amountPiastres: a.amountPiastres,
    })),
    grossPiastres: packageGross(p),
    note: p.note,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    current,
  };
}
export type SalaryPackageView = ReturnType<typeof packageView>;

/**
 * The package in force on a day: the latest that started on or before it. Before the first
 * package was recorded the first one applies (nothing older was ever kept), so a month already
 * worked is paid on it.
 */
export async function packageInForce(db: Db, employeeId: string, onDay: string) {
  const latest = await db.salaryPackage.findFirst({
    where: { employeeId, effectiveFrom: { lte: toDate(onDay) } },
    include: packageInclude,
    orderBy: { effectiveFrom: 'desc' },
  });
  if (latest) return latest;
  return db.salaryPackage.findFirst({
    where: { employeeId },
    include: packageInclude,
    orderBy: { effectiveFrom: 'asc' },
  });
}

/** Every package of a person, newest first, the one in force today marked current. */
export async function listSalaryPackages(db: Db, employeeId: string) {
  const rows = await db.salaryPackage.findMany({
    where: { employeeId },
    include: packageInclude,
    orderBy: { effectiveFrom: 'desc' },
  });
  const now = await packageInForce(db, employeeId, cairoDay(new Date()));
  return rows.map((p) => packageView(p, p.id === now?.id));
}

/** The package in force today, as the file shows it (null when none was ever set). */
export async function currentPackage(db: Db, employeeId: string) {
  const p = await packageInForce(db, employeeId, cairoDay(new Date()));
  return p ? packageView(p, true) : null;
}

const snapshot = (p: PackageRow | null) =>
  p
    ? {
        effectiveFrom: day(p.effectiveFrom),
        basicPiastres: p.basicPiastres,
        insuredWagePiastres: p.insuredWagePiastres,
        allowances: p.allowances.map((a) => ({
          kind: a.kind,
          label: a.label,
          amountPiastres: a.amountPiastres,
        })),
        grossPiastres: packageGross(p),
      }
    : null;

/**
 * Records a salary package from a day on (HR use with the salaries switch). A package on the
 * same day replaces that day's row; any other day adds a row, so the history stays. The first
 * package starts on the hire date when no day is given; later ones today. People hired through
 * an outsourcing company are paid by it and have no package.
 */
export function setSalaryPackage(
  db: Db,
  input: { employeeId: string; body: SalaryPackageBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const e = await tx.employee.findUnique({
      where: { id: input.employeeId },
      include: { grade: true },
    });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (e.employment === 'outsourced') throw new DomainError('outsourced_not_on_payroll', 400);
    if (e.status === 'left') throw new DomainError('employee_left', 409);
    const today = cairoDay(new Date());
    const count = await tx.salaryPackage.count({ where: { employeeId: e.id } });
    const hire = e.hireDate ? day(e.hireDate) : null;
    const from = input.body.effectiveFrom ?? (count === 0 && hire && hire < today ? hire : today);
    const before = await packageInForce(tx, e.id, from);
    const sameDay = await tx.salaryPackage.findUnique({
      where: { employeeId_effectiveFrom: { employeeId: e.id, effectiveFrom: toDate(from) } },
    });
    const allowances = input.body.allowances
      .filter((a) => a.amountPiastres > 0)
      .map((a) => ({ kind: a.kind, label: a.label || null, amountPiastres: a.amountPiastres }));
    const data = {
      basicPiastres: input.body.basicPiastres,
      insuredWagePiastres: input.body.insuredWagePiastres ?? null,
      note: input.body.note || null,
      createdById: input.actorUserId,
    };
    let saved: PackageRow;
    if (sameDay) {
      await tx.salaryAllowance.deleteMany({ where: { packageId: sameDay.id } });
      saved = await tx.salaryPackage.update({
        where: { id: sameDay.id },
        data: { ...data, allowances: { create: allowances } },
        include: packageInclude,
      });
    } else {
      saved = await tx.salaryPackage.create({
        data: {
          ...data,
          employeeId: e.id,
          effectiveFrom: toDate(from),
          allowances: { create: allowances },
        },
        include: packageInclude,
      });
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.package',
      entityType: 'employee',
      entityId: e.id,
      before: snapshot(before),
      after: { ...snapshot(saved)!, ...(data.note && { note: data.note }) },
    });
    const gross = packageGross(saved);
    const band = e.grade;
    return {
      ...packageView(saved, from <= today),
      // A package outside the grade's band is allowed; the screen warns.
      outsideBand: Boolean(
        band &&
        ((band.bandMinPiastres != null && gross < band.bandMinPiastres) ||
          (band.bandMaxPiastres != null && gross > band.bandMaxPiastres)),
      ),
    };
  });
}

/**
 * The basic salary alone (no allowances), for the seed, the demo and older callers: a package
 * on the person's file from the default day.
 */
export async function setSalary(
  db: Db,
  input: {
    userId: string;
    monthlyPiastres: number;
    insuredWagePiastres?: number | null;
    actorUserId: string;
  },
) {
  if (!Number.isSafeInteger(input.monthlyPiastres) || input.monthlyPiastres < 0)
    throw new DomainError('invalid_amount', 400);
  const e = await inTransaction(db, (tx) => ensureEmployee(tx, input.userId));
  if (!e) throw new DomainError('user_not_found', 404);
  await setSalaryPackage(db, {
    employeeId: e.id,
    body: {
      basicPiastres: input.monthlyPiastres,
      insuredWagePiastres: input.insuredWagePiastres ?? null,
      allowances: [],
    },
    actorUserId: input.actorUserId,
  });
  return { userId: input.userId, monthlyPiastres: input.monthlyPiastres };
}

/**
 * Marks a person as an employee (on our payroll) or as hired through an outsourcing company
 * (a supplier that bills us for them). The contract type follows. HR use.
 */
export function setEmployment(
  db: Db,
  input: {
    userId: string;
    employment: Employment;
    staffingSupplierId?: string | null;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const e = await ensureEmployee(tx, input.userId);
    if (!e) throw new DomainError('user_not_found', 404);
    const supplierId =
      input.employment === 'outsourced' ? (input.staffingSupplierId ?? null) : null;
    if (input.employment === 'outsourced') {
      if (!supplierId) throw new DomainError('staffing_company_required', 400);
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier || !supplier.isActive) throw new DomainError('supplier_not_found', 404);
    }
    const contractType =
      input.employment === 'outsourced'
        ? 'outsourced'
        : e.contractType === 'outsourced'
          ? 'permanent'
          : e.contractType;
    const after = await tx.employee.update({
      where: { id: e.id },
      data: { employment: input.employment, staffingSupplierId: supplierId, contractType },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.employment',
      entityType: 'employee',
      entityId: e.id,
      before: { employment: e.employment, staffingSupplierId: e.staffingSupplierId },
      after: { employment: after.employment, staffingSupplierId: after.staffingSupplierId },
    });
    return {
      userId: input.userId,
      employeeId: e.id,
      employment: after.employment,
      staffingSupplierId: supplierId,
    };
  });
}

/** Whether a person is paid through an outsourcing company (from their file). */
export async function employmentOf(tx: Tx | Db, userId: string) {
  const e = await tx.employee.findUnique({
    where: { userId },
    select: { id: true, employment: true, staffingSupplierId: true },
  });
  return e ?? { id: null, employment: 'employee' as const, staffingSupplierId: null };
}

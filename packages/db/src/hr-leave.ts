import type { LeaveBalanceKind, LeaveRequestStatus, Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  carryOver,
  countedMonths,
  days2,
  employeeCode,
  floorHalf,
  type HrLeaveRequestBody,
  type LeaveAdjustmentBody,
  type LeaveRequestBody,
  leaveRequestNumber,
  type LeaveTypeBody,
  leaveYearOf,
  leaveYearRange,
  OFFICE_WEEKDAYS,
  prorate,
  workingDays,
} from '@shiplynow/shared';
import { rebuildAttendanceDays } from './attendance';
import { recordAudit } from './audit';
import { looksLike } from './hr-documents';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { managerOf, teamIds } from './hr-org';
import { getSetting } from './settings';

// HR phase 3 (docs/HR.md "Phase 3 as built"): leave types HR manages, balances per person and
// leave year (entitlement from the position, else the grade, else a setting; prorated for
// joiners; granted yearly or earned monthly; carried over up to a limit; HR adjustments kept as
// rows) and requests approved in two steps (the manager in force, then HR). Nothing is stored
// as a balance: it is always summed from the rows. Approved days show on the roster, mark the
// attendance days on leave, and unpaid days reach the salary run once.

/** Store scope of the person asking: null is every store (docs/ACCESS.md). */
export type StoreScope = string[] | null;

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));
const PENDING = ['pending_manager', 'pending_hr'] as const;
const LIVE = [...PENDING, 'approved'] as const;
const MAX_DOCUMENT_BYTES = 3_000_000;
const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function inStoreScope(scope: StoreScope, storeId: string | null) {
  return scope === null || (storeId !== null && scope.includes(storeId));
}

/** The employee file of a signed in person (merchants and people without one: 404). */
export async function ownFile(db: Db, userId: string) {
  const e = await db.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!e) throw new DomainError('employee_not_found', 404);
  return e.id;
}

// ─── leave types ───────────────────────────────────────────────────────────────

type TypeRow = Prisma.LeaveTypeGetPayload<object>;

function typeView(t: TypeRow) {
  return {
    id: t.id,
    code: t.code,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    paid: t.paid,
    balance: t.balance,
    yearlyDays: num(t.yearlyDays),
    casualAllowance: t.casualAllowance,
    documentAboveDays: t.documentAboveDays,
    maxDaysPerRequest: t.maxDaysPerRequest,
    noticeDays: t.noticeDays,
    selfRequest: t.selfRequest,
    isActive: t.isActive,
    sort: t.sort,
  };
}
export type LeaveTypeView = ReturnType<typeof typeView>;

export async function listLeaveTypes(db: Db, options: { activeOnly?: boolean } = {}) {
  const rows = await db.leaveType.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: [{ isActive: 'desc' }, { sort: 'asc' }, { nameEn: 'asc' }],
  });
  return rows.map(typeView);
}

function typeData(body: LeaveTypeBody) {
  if (body.balance === 'own' && body.yearlyDays === null && !body.casualAllowance)
    throw new DomainError('allowance_required', 400);
  return {
    code: body.code,
    nameEn: body.nameEn,
    nameAr: body.nameAr,
    paid: body.paid,
    balance: body.balance,
    yearlyDays: body.balance === 'none' ? null : body.yearlyDays,
    casualAllowance: body.balance === 'none' ? false : body.casualAllowance,
    documentAboveDays: body.documentAboveDays,
    maxDaysPerRequest: body.maxDaysPerRequest,
    noticeDays: body.noticeDays,
    selfRequest: body.selfRequest,
    isActive: body.isActive,
    ...(body.sort !== undefined && { sort: body.sort }),
  };
}

export function createLeaveType(db: Db, input: { body: LeaveTypeBody; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    if (await tx.leaveType.findUnique({ where: { code: input.body.code } }))
      throw new DomainError('code_taken');
    const t = await tx.leaveType.create({ data: typeData(input.body) });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'leave_type.create',
      entityType: 'leave_type',
      entityId: t.id,
      after: typeView(t),
    });
    return typeView(t);
  });
}

export function updateLeaveType(
  db: Db,
  input: { typeId: string; body: LeaveTypeBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.leaveType.findUnique({ where: { id: input.typeId } });
    if (!before) throw new DomainError('leave_type_not_found', 404);
    const clash = await tx.leaveType.findUnique({ where: { code: input.body.code } });
    if (clash && clash.id !== before.id) throw new DomainError('code_taken');
    const t = await tx.leaveType.update({ where: { id: before.id }, data: typeData(input.body) });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'leave_type.update',
      entityType: 'leave_type',
      entityId: t.id,
      before: typeView(before),
      after: typeView(t),
    });
    return typeView(t);
  });
}

// ─── balances ──────────────────────────────────────────────────────────────────

interface LeaveRules {
  startMonth: number;
  monthly: boolean;
  carryLimit: number;
  defaultAnnual: number;
  casualDays: number;
}

async function leaveRules(db: Db): Promise<LeaveRules> {
  return {
    startMonth: await getSetting(db, 'hr.leave_year_start_month'),
    monthly: (await getSetting(db, 'hr.leave_accrual_monthly')) === 1,
    carryLimit: await getSetting(db, 'hr.leave_carry_over_days'),
    defaultAnnual: await getSetting(db, 'hr.default_annual_leave_days'),
    casualDays: await getSetting(db, 'hr.casual_leave_days'),
  };
}

/**
 * A person's yearly annual leave days: the position's, else the grade's, else
 * hr.default_annual_leave_days. Answers where it came from too.
 */
export async function annualEntitlement(db: Db, employeeId: string) {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      position: { select: { annualLeaveDays: true } },
      grade: { select: { annualLeaveDays: true } },
    },
  });
  if (!e) throw new DomainError('employee_not_found', 404);
  if (e.position?.annualLeaveDays != null)
    return { days: e.position.annualLeaveDays, source: 'position' as const };
  if (e.grade?.annualLeaveDays != null)
    return { days: e.grade.annualLeaveDays, source: 'grade' as const };
  return {
    days: await getSetting(db, 'hr.default_annual_leave_days'),
    source: 'default' as const,
  };
}

interface DayRow {
  day: string;
  fraction: number;
  paid: boolean;
  status: string;
  typeId: string;
  balance: LeaveBalanceKind;
  requestId: string;
}

async function dayRows(db: Db, employeeId: string, from: string, to: string): Promise<DayRow[]> {
  const rows = await db.leaveRequestDay.findMany({
    where: {
      employeeId,
      day: { gte: dayDate(from), lte: dayDate(to) },
      request: { status: { in: [...LIVE] } },
    },
    select: {
      day: true,
      fraction: true,
      paid: true,
      requestId: true,
      request: { select: { status: true, typeId: true, type: { select: { balance: true } } } },
    },
  });
  return rows.map((r) => ({
    day: dayText(r.day),
    fraction: Number(r.fraction),
    paid: r.paid,
    status: r.request.status,
    typeId: r.request.typeId,
    balance: r.request.type.balance,
    requestId: r.requestId,
  }));
}

const sum = (rows: DayRow[]) => days2(rows.reduce((s, r) => s + r.fraction, 0));

export interface BalanceLine {
  /** null: the annual balance */
  typeId: string | null;
  /** The year's allowance after proration (annual) or the type's allowance (own) */
  entitlement: number;
  carriedIn: number;
  adjustments: number;
  /** Approved days taken from this balance */
  taken: number;
  /** Days asked for and not decided yet */
  pending: number;
  remaining: number;
  /** What can still be asked for: remaining minus pending */
  available: number;
}

/**
 * Every balance of a person for one leave year, as of a day: the annual balance (entitlement,
 * carry over, adjustments, approved days of every type counted against it), each type with its
 * own allowance, and the cap of types limited inside the annual balance (casual leave).
 * `excludeRequestId` leaves a request out (its own approval check).
 */
export async function leaveBalances(
  db: Db,
  input: { employeeId: string; year?: number; asOf?: string; excludeRequestId?: string },
) {
  const asOf = input.asOf ?? cairoDay(new Date());
  const rules = await leaveRules(db);
  const year = input.year ?? leaveYearOf(asOf, rules.startMonth);
  const e = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, hireDate: true },
  });
  if (!e) throw new DomainError('employee_not_found', 404);
  const hire = e.hireDate ? dayText(e.hireDate) : null;
  const base = await annualEntitlement(db, e.id);
  const types = await db.leaveType.findMany({ orderBy: [{ sort: 'asc' }, { nameEn: 'asc' }] });
  const adjustments = await db.leaveAdjustment.findMany({
    where: { employeeId: e.id, year: { lte: year } },
    select: { typeId: true, year: true, days: true },
  });
  const adjusted = (typeId: string | null, y: number) =>
    days2(
      adjustments
        .filter((a) => a.typeId === typeId && a.year === y)
        .reduce((s, a) => s + Number(a.days), 0),
    );

  // The annual balance from the first year that counts (the hire year, at most five back),
  // so the carry over into this year is known.
  const firstYear = Math.max(year - 5, hire ? leaveYearOf(hire, rules.startMonth) : year - 5);
  let carried = 0;
  let annual: BalanceLine | null = null;
  for (let y = Math.min(firstYear, year); y <= year; y++) {
    const range = leaveYearRange(y, rules.startMonth);
    const asOfY = y < year ? range.to : asOf;
    const months = countedMonths({
      year: y,
      startMonth: rules.startMonth,
      hireDate: hire,
      asOf: asOfY,
      monthly: rules.monthly,
    });
    const rows = (await dayRows(db, e.id, range.from, range.to)).filter(
      (r) => r.requestId !== input.excludeRequestId && r.balance === 'annual',
    );
    const taken = sum(rows.filter((r) => r.status === 'approved' && r.paid));
    const pending = sum(rows.filter((r) => r.status !== 'approved'));
    const entitlement = prorate(base.days, months);
    const carriedIn = y === firstYear ? 0 : carried;
    const remaining = days2(entitlement + carriedIn + adjusted(null, y) - taken);
    annual = {
      typeId: null,
      entitlement,
      carriedIn,
      adjustments: adjusted(null, y),
      taken,
      pending,
      remaining,
      available: days2(remaining - pending),
    };
    carried = carryOver(remaining, rules.carryLimit);
  }

  const range = leaveYearRange(year, rules.startMonth);
  const rows = (await dayRows(db, e.id, range.from, range.to)).filter(
    (r) => r.requestId !== input.excludeRequestId,
  );
  const lines = types.map((t) => {
    const mine = rows.filter((r) => r.typeId === t.id);
    const taken = sum(mine.filter((r) => r.status === 'approved' && r.paid));
    const pending = sum(mine.filter((r) => r.status !== 'approved'));
    const allowance = t.casualAllowance ? rules.casualDays : num(t.yearlyDays);
    let entitlement: number | null = null;
    if (t.balance === 'own' && allowance !== null) entitlement = allowance;
    // A cap inside the annual balance (casual leave): the type's own limit for the year.
    if (t.balance === 'annual' && allowance !== null) entitlement = allowance;
    const adjustmentsDays = adjusted(t.id, year);
    const remaining = entitlement === null ? null : days2(entitlement + adjustmentsDays - taken);
    let available = remaining === null ? null : days2(remaining - pending);
    if (t.balance === 'annual')
      available = available === null ? annual!.available : Math.min(available, annual!.available);
    return {
      type: typeView(t),
      entitlement,
      adjustments: adjustmentsDays,
      taken,
      pending,
      remaining,
      available,
      unpaidTaken: sum(mine.filter((r) => r.status === 'approved' && !r.paid)),
    };
  });
  return {
    year,
    from: range.from,
    to: range.to,
    accrual: rules.monthly ? ('monthly' as const) : ('yearly' as const),
    annualDays: base.days,
    annualSource: base.source,
    hireDate: hire,
    annual: annual!,
    types: lines,
  };
}
export type LeaveBalances = Awaited<ReturnType<typeof leaveBalances>>;

/** HR changes a balance with a reason; kept as a row (balances are always summed). */
export function adjustLeaveBalance(
  db: Db,
  input: { body: LeaveAdjustmentBody; actorUserId: string; scope: StoreScope },
) {
  return inTransaction(db, async (tx) => {
    const e = await tx.employee.findUnique({ where: { id: input.body.employeeId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (!inStoreScope(input.scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
    if (input.body.typeId) {
      const t = await tx.leaveType.findUnique({ where: { id: input.body.typeId } });
      if (!t) throw new DomainError('leave_type_not_found', 404);
      if (t.balance === 'none') throw new DomainError('type_has_no_balance', 400);
    }
    const row = await tx.leaveAdjustment.create({
      data: {
        employeeId: e.id,
        typeId: input.body.typeId,
        year: input.body.year,
        days: input.body.days,
        reason: input.body.reason,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'leave.balance_adjust',
      entityType: 'employee',
      entityId: e.id,
      after: {
        adjustmentId: row.id,
        typeId: row.typeId,
        year: row.year,
        days: input.body.days,
        reason: row.reason,
      },
    });
    return { id: row.id };
  });
}

export async function listAdjustments(db: Db, employeeId: string, year: number) {
  const rows = await db.leaveAdjustment.findMany({
    where: { employeeId, year },
    include: { type: { select: { nameEn: true, nameAr: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const names = await userNames(
    db,
    rows.map((r) => r.createdById),
  );
  return rows.map((r) => ({
    id: r.id,
    typeId: r.typeId,
    type: r.type,
    year: r.year,
    days: Number(r.days),
    reason: r.reason,
    by: names.get(r.createdById) ?? null,
    at: r.createdAt,
  }));
}

async function userNames(db: Db, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const users = list.length
    ? await db.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })
    : [];
  return new Map(users.map((u) => [u.id, u.name]));
}

/** The annual balance of everyone in scope for a leave year (HR's balances page). */
export async function balancesReport(
  db: Db,
  input: { scope: StoreScope; year?: number; storeId?: string; departmentId?: string },
) {
  const rules = await leaveRules(db);
  const today = cairoDay(new Date());
  const year = input.year ?? leaveYearOf(today, rules.startMonth);
  const people = await db.employee.findMany({
    where: {
      status: { not: 'left' },
      ...(input.scope && { homeStoreId: { in: input.scope } }),
      ...(input.storeId && { homeStoreId: input.storeId }),
      ...(input.departmentId && { departmentId: input.departmentId }),
    },
    select: {
      id: true,
      number: true,
      nameEn: true,
      nameAr: true,
      homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      department: { select: { id: true, nameEn: true, nameAr: true } },
    },
    orderBy: { nameEn: 'asc' },
    take: 1000,
  });
  const asOf = leaveYearRange(year, rules.startMonth).to < today ? undefined : today;
  const rows = [];
  for (const p of people) {
    const b = await leaveBalances(db, {
      employeeId: p.id,
      year,
      asOf: asOf ?? leaveYearRange(year, rules.startMonth).to,
    });
    rows.push({
      employee: {
        id: p.id,
        code: employeeCode(p.number),
        nameEn: p.nameEn,
        nameAr: p.nameAr,
      },
      store: p.homeStore,
      department: p.department,
      annualDays: b.annualDays,
      annualSource: b.annualSource,
      annual: b.annual,
      types: b.types
        .filter((t) => t.taken > 0 || t.pending > 0 || t.unpaidTaken > 0)
        .map((t) => ({
          typeId: t.type.id,
          nameEn: t.type.nameEn,
          nameAr: t.type.nameAr,
          taken: t.taken,
          unpaid: t.unpaidTaken,
          pending: t.pending,
        })),
    });
  }
  return { year, ...leaveYearRange(year, rules.startMonth), people: rows };
}

// ─── requests ──────────────────────────────────────────────────────────────────

/**
 * The working days of a period for a person: their roster (a shift counts, a day off not),
 * else their default shift's weekdays, else Sunday to Thursday; official holidays never count.
 */
export async function leaveWorkingDays(db: Db, employeeId: string, from: string, to: string) {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: { defaultShift: { select: { weekdays: true, isActive: true } } },
  });
  const [roster, holidays] = await Promise.all([
    db.rosterDay.findMany({
      where: { employeeId, day: { gte: dayDate(from), lte: dayDate(to) } },
      select: { day: true, shiftId: true },
    }),
    db.holiday.findMany({
      where: { day: { gte: dayDate(from), lte: dayDate(to) } },
      select: { day: true },
    }),
  ]);
  return workingDays({
    from,
    to,
    holidays: new Set(holidays.map((h) => dayText(h.day))),
    roster: new Map(roster.map((r) => [dayText(r.day), r.shiftId !== null])),
    defaultWeekdays:
      e?.defaultShift && e.defaultShift.isActive ? e.defaultShift.weekdays : OFFICE_WEEKDAYS,
  });
}

/** What a balance type still allows in the year of `day` (null: no balance). */
async function availableFor(
  db: Db,
  employeeId: string,
  typeId: string,
  day: string,
  excludeRequestId?: string,
) {
  const rules = await leaveRules(db);
  const b = await leaveBalances(db, {
    employeeId,
    year: leaveYearOf(day, rules.startMonth),
    excludeRequestId,
  });
  const line = b.types.find((t) => t.type.id === typeId);
  if (!line || line.type.balance === 'none') return null;
  return line.available;
}

/** Days of a request per leave year (a request may cross the year's end). */
async function daysPerYear(db: Db, days: string[], fraction: number) {
  const startMonth = await getSetting(db, 'hr.leave_year_start_month');
  const out = new Map<number, number>();
  for (const d of days) {
    const y = leaveYearOf(d, startMonth);
    out.set(y, (out.get(y) ?? 0) + fraction);
  }
  return out;
}

const requestInclude = {
  type: true,
  employee: {
    select: {
      id: true,
      number: true,
      nameEn: true,
      nameAr: true,
      userId: true,
      homeStoreId: true,
      employment: true,
      homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      department: { select: { id: true, nameEn: true, nameAr: true } },
      photo: { select: { updatedAt: true } },
    },
  },
} as const;
type RequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>;

function requestView(r: RequestRow) {
  return {
    id: r.id,
    number: leaveRequestNumber(r.number),
    employee: {
      id: r.employee.id,
      code: employeeCode(r.employee.number),
      nameEn: r.employee.nameEn,
      nameAr: r.employee.nameAr,
      userId: r.employee.userId,
      store: r.employee.homeStore,
      department: r.employee.department,
      photoVersion: r.employee.photo ? r.employee.photo.updatedAt.getTime() : null,
    },
    type: typeView(r.type),
    from: dayText(r.fromDay),
    to: dayText(r.toDay),
    halfDay: r.halfDay,
    days: Number(r.days),
    note: r.note,
    status: r.status,
    onBehalf: r.onBehalf,
    overrideBalance: r.overrideBalance,
    overrideBackdate: r.overrideBackdate,
    hasDocument: !!r.documentContentType,
    documentName: r.documentName,
    documentNeeded: r.type.documentAboveDays !== null && Number(r.days) > r.type.documentAboveDays,
    managerEmployeeId: r.managerEmployeeId,
    managerDecidedAt: r.managerDecidedAt,
    hrDecidedAt: r.hrDecidedAt,
    rejectedAt: r.rejectedAt,
    rejectReason: r.rejectReason,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt,
  };
}
export type LeaveRequestView = ReturnType<typeof requestView>;

/**
 * A person asks for leave (from My HR), or HR asks for them (onBehalf, with optional overrides
 * of the balance and how far back it may start). Refuses overlaps, a type the person may not
 * ask for, too short notice, too many days, and more than the balance (except types without
 * one). Goes to the manager in force, or straight to HR when the person has none.
 */
export function requestLeave(
  db: Db,
  input: {
    employeeId: string;
    body: LeaveRequestBody | HrLeaveRequestBody;
    actorUserId: string;
    onBehalf: boolean;
    scope?: StoreScope;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const today = cairoDay(now);
    const body = input.body;
    const seen = await tx.leaveRequest.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
      include: requestInclude,
    });
    if (seen) {
      if (seen.employeeId !== input.employeeId) throw new DomainError('idempotency_key_reused');
      return requestView(seen);
    }
    await tx.$queryRaw`SELECT id FROM employees WHERE id = ${input.employeeId} FOR UPDATE`;
    const e = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (input.scope !== undefined && !inStoreScope(input.scope, e.homeStoreId))
      throw new DomainError('store_not_allowed', 403);
    if (e.status === 'left' || e.status === 'suspended')
      throw new DomainError('employee_not_active', 403);
    const type = await tx.leaveType.findUnique({ where: { id: body.typeId } });
    if (!type || !type.isActive) throw new DomainError('leave_type_not_found', 404);
    if (!input.onBehalf && !type.selfRequest) throw new DomainError('leave_type_hr_only', 403);
    const hr = input.onBehalf ? (body as HrLeaveRequestBody) : null;
    if (body.from > body.to) throw new DomainError('invalid_range', 400);
    if (addDays(body.from, 366) < body.to) throw new DomainError('range_too_long', 400);
    if (body.halfDay && body.from !== body.to) throw new DomainError('half_day_one_day', 400);
    const backdate = await getSetting(tx, 'hr.leave_backdate_days');
    if (body.from < addDays(today, -backdate) && !hr?.overrideBackdate)
      throw new DomainError('leave_too_far_back', 400, { days: backdate });
    if (!input.onBehalf && type.noticeDays > 0 && body.from < addDays(today, type.noticeDays))
      throw new DomainError('leave_notice', 400, { days: type.noticeDays });
    const days = await leaveWorkingDays(tx, e.id, body.from, body.to);
    if (days.length === 0) throw new DomainError('no_working_days', 400);
    const fraction = body.halfDay ? 0.5 : 1;
    const total = days2(days.length * fraction);
    if (type.maxDaysPerRequest !== null && total > type.maxDaysPerRequest)
      throw new DomainError('leave_too_long', 400, { days: type.maxDaysPerRequest });
    const overlap = await tx.leaveRequest.findFirst({
      where: {
        employeeId: e.id,
        status: { in: [...LIVE] },
        fromDay: { lte: dayDate(body.to) },
        toDay: { gte: dayDate(body.from) },
      },
    });
    if (overlap)
      throw new DomainError('leave_overlap', 409, { number: leaveRequestNumber(overlap.number) });
    if (type.balance !== 'none' && !hr?.overrideBalance) {
      for (const [year, asked] of await daysPerYear(tx, days, fraction)) {
        const startMonth = await getSetting(tx, 'hr.leave_year_start_month');
        const available = await availableFor(
          tx,
          e.id,
          type.id,
          leaveYearRange(year, startMonth).from,
        );
        if (available !== null && asked > available)
          throw new DomainError('leave_above_balance', 409, { available: Math.max(0, available) });
      }
    }
    const manager = await managerOf(tx, e.id);
    const status = manager.managerId ? 'pending_manager' : 'pending_hr';
    const request = await tx.leaveRequest.create({
      data: {
        employeeId: e.id,
        typeId: type.id,
        fromDay: dayDate(body.from),
        toDay: dayDate(body.to),
        halfDay: body.halfDay,
        days: total,
        note: body.note ?? null,
        status,
        managerEmployeeId: manager.managerId,
        requestedById: input.actorUserId,
        onBehalf: input.onBehalf,
        overrideBalance: hr?.overrideBalance ?? false,
        overrideBackdate: hr?.overrideBackdate ?? false,
        idempotencyKey: body.idempotencyKey,
        dayRows: {
          create: days.map((d) => ({ employeeId: e.id, day: dayDate(d), fraction })),
        },
      },
      include: requestInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'leave.request',
      entityType: 'leave_request',
      entityId: request.id,
      after: {
        employeeId: e.id,
        type: type.code,
        from: body.from,
        to: body.to,
        days: total,
        status,
        onBehalf: input.onBehalf,
      },
    });
    return requestView(request);
  });
}

async function loadRequest(tx: Db, requestId: string) {
  await tx.$queryRaw`SELECT id FROM leave_requests WHERE id = ${requestId} FOR UPDATE`;
  const r = await tx.leaveRequest.findUnique({ where: { id: requestId }, include: requestInclude });
  if (!r) throw new DomainError('leave_request_not_found', 404);
  return r;
}

/** The employee file id of the person acting (null: they have none). */
async function actorFile(db: Db, userId: string) {
  return (await db.employee.findUnique({ where: { userId }, select: { id: true } }))?.id ?? null;
}

/**
 * Step one: the manager in force approves or refuses. Nobody decides on their own request; only
 * the person's manager (as HR v2 defines it) may.
 */
export function managerDecideLeave(
  db: Db,
  input: {
    requestId: string;
    actorUserId: string;
    approve: boolean;
    reason?: string;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const r = await loadRequest(tx, input.requestId);
    if (r.employee.userId === input.actorUserId) throw new DomainError('own_request', 403);
    const me = await actorFile(tx, input.actorUserId);
    const manager = await managerOf(tx, r.employeeId);
    if (!me || manager.managerId !== me) throw new DomainError('not_your_team', 403);
    if (r.status !== 'pending_manager') throw new DomainError('leave_not_waiting');
    if (!input.approve && !input.reason) throw new DomainError('reason_required', 400);
    const after = await tx.leaveRequest.update({
      where: { id: r.id },
      data: input.approve
        ? { status: 'pending_hr', managerDecidedById: input.actorUserId, managerDecidedAt: now }
        : {
            status: 'rejected',
            managerDecidedById: input.actorUserId,
            managerDecidedAt: now,
            rejectedById: input.actorUserId,
            rejectedAt: now,
            rejectReason: input.reason,
          },
      include: requestInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.approve ? 'leave.manager_approve' : 'leave.reject',
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: r.status },
      after: { status: after.status, reason: input.reason ?? null, step: 'manager' },
    });
    return requestView(after);
  });
}

/**
 * Step two: HR (hr use) approves after the manager, or refuses at either step. Approving checks
 * the document and the balance again and fixes which days are paid: unpaid types, and days
 * beyond the balance when HR allowed that, are unpaid and reach the salary run. The person's
 * closed attendance days in the period are built again (on leave).
 */
export function hrDecideLeave(
  db: Db,
  input: {
    requestId: string;
    actorUserId: string;
    approve: boolean;
    reason?: string;
    scope: StoreScope;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const r = await loadRequest(tx, input.requestId);
    if (!inStoreScope(input.scope, r.employee.homeStoreId))
      throw new DomainError('store_not_allowed', 403);
    if (r.employee.userId === input.actorUserId) throw new DomainError('own_request', 403);
    if (!input.approve) {
      if (!PENDING.includes(r.status as (typeof PENDING)[number]))
        throw new DomainError('leave_not_waiting');
      if (!input.reason) throw new DomainError('reason_required', 400);
      const after = await tx.leaveRequest.update({
        where: { id: r.id },
        data: {
          status: 'rejected',
          hrDecidedById: input.actorUserId,
          hrDecidedAt: now,
          rejectedById: input.actorUserId,
          rejectedAt: now,
          rejectReason: input.reason,
        },
        include: requestInclude,
      });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'leave.reject',
        entityType: 'leave_request',
        entityId: r.id,
        before: { status: r.status },
        after: { status: 'rejected', reason: input.reason, step: 'hr' },
      });
      return requestView(after);
    }
    if (r.status !== 'pending_hr') throw new DomainError('leave_not_waiting');
    if (
      r.type.documentAboveDays !== null &&
      Number(r.days) > r.type.documentAboveDays &&
      !r.documentContentType
    )
      throw new DomainError('document_required', 409);
    const rows = await tx.leaveRequestDay.findMany({
      where: { requestId: r.id },
      orderBy: { day: 'asc' },
    });
    // Which days are paid: none for an unpaid type; for a balance type, as many as the balance
    // still holds in each leave year (the rest only when HR allowed going above it).
    const unpaid = new Set<string>();
    if (!r.type.paid) for (const d of rows) unpaid.add(d.id);
    else if (r.type.balance !== 'none') {
      const startMonth = await getSetting(tx, 'hr.leave_year_start_month');
      const byYear = new Map<number, typeof rows>();
      for (const d of rows) {
        const y = leaveYearOf(dayText(d.day), startMonth);
        byYear.set(y, [...(byYear.get(y) ?? []), d]);
      }
      for (const [year, list] of byYear) {
        const available = await availableFor(
          tx,
          r.employeeId,
          r.typeId,
          leaveYearRange(year, startMonth).from,
          r.id,
        );
        let left = available === null ? Infinity : Math.max(0, floorHalf(available));
        for (const d of list) {
          const f = Number(d.fraction);
          if (f <= left) left -= f;
          else unpaid.add(d.id);
        }
      }
      if (unpaid.size > 0 && !r.overrideBalance) throw new DomainError('leave_above_balance', 409);
    }
    if (unpaid.size)
      await tx.leaveRequestDay.updateMany({
        where: { id: { in: [...unpaid] } },
        data: { paid: false },
      });
    const after = await tx.leaveRequest.update({
      where: { id: r.id },
      data: { status: 'approved', hrDecidedById: input.actorUserId, hrDecidedAt: now },
      include: requestInclude,
    });
    await rebuildAttendanceDays(
      tx,
      r.employeeId,
      rows.map((d) => dayText(d.day)),
      now,
    );
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'leave.approve',
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: r.status },
      after: { status: 'approved', unpaidDays: unpaid.size },
    });
    return requestView(after);
  });
}

/**
 * Cancels a request: the person while it waits, HR (hr use) at any time before its days reach
 * the salary run. A cancelled approved request gives its days back (the balance is summed again)
 * and the attendance days are built again.
 */
export function cancelLeave(
  db: Db,
  input: {
    requestId: string;
    actorUserId: string;
    asHr: boolean;
    reason?: string;
    scope?: StoreScope;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const r = await loadRequest(tx, input.requestId);
    const own = r.employee.userId === input.actorUserId;
    if (input.asHr) {
      if (!inStoreScope(input.scope ?? null, r.employee.homeStoreId))
        throw new DomainError('store_not_allowed', 403);
    } else if (!own) throw new DomainError('leave_request_not_found', 404);
    if (r.status === 'approved') {
      if (!input.asHr) throw new DomainError('approved_leave_hr_only', 403);
      if (!input.reason) throw new DomainError('reason_required', 400);
      const paid = await tx.leaveRequestDay.count({
        where: { requestId: r.id, payrollEntryId: { not: null } },
      });
      if (paid > 0) throw new DomainError('leave_in_payroll');
    } else if (!PENDING.includes(r.status as (typeof PENDING)[number]))
      throw new DomainError('leave_not_waiting');
    const after = await tx.leaveRequest.update({
      where: { id: r.id },
      data: {
        status: 'cancelled',
        cancelledById: input.actorUserId,
        cancelledAt: now,
        cancelReason: input.reason ?? null,
      },
      include: requestInclude,
    });
    if (r.status === 'approved') {
      const rows = await tx.leaveRequestDay.findMany({ where: { requestId: r.id } });
      await rebuildAttendanceDays(
        tx,
        r.employeeId,
        rows.map((d) => dayText(d.day)),
        now,
      );
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'leave.cancel',
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: r.status },
      after: { status: 'cancelled', reason: input.reason ?? null, byHr: input.asHr },
    });
    return requestView(after);
  });
}

/** A medical note or other paper for a waiting request: the person or HR adds it. */
export function attachLeaveDocument(
  db: Db,
  input: {
    requestId: string;
    actorUserId: string;
    asHr: boolean;
    scope?: StoreScope;
    contentType: string;
    data: Buffer;
    name?: string | null;
  },
) {
  return inTransaction(db, async (tx) => {
    const r = await loadRequest(tx, input.requestId);
    if (input.asHr) {
      if (!inStoreScope(input.scope ?? null, r.employee.homeStoreId))
        throw new DomainError('store_not_allowed', 403);
    } else if (r.employee.userId !== input.actorUserId)
      throw new DomainError('leave_request_not_found', 404);
    if (!PENDING.includes(r.status as (typeof PENDING)[number]))
      throw new DomainError('leave_not_waiting');
    if (!DOCUMENT_TYPES.includes(input.contentType) || !looksLike(input.contentType, input.data))
      throw new DomainError('document_type_not_allowed', 400);
    if (input.data.length === 0 || input.data.length > MAX_DOCUMENT_BYTES)
      throw new DomainError('document_too_large', 400);
    await tx.leaveRequest.update({
      where: { id: r.id },
      data: {
        documentContentType: input.contentType,
        documentData: new Uint8Array(input.data),
        documentName: input.name?.slice(0, 200) ?? null,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'leave.document',
      entityType: 'leave_request',
      entityId: r.id,
      after: { contentType: input.contentType, bytes: input.data.length },
    });
    return { attached: true };
  });
}

export async function leaveDocument(db: Db, requestId: string) {
  const r = await db.leaveRequest.findUnique({
    where: { id: requestId },
    select: {
      documentContentType: true,
      documentData: true,
      documentName: true,
      employee: { select: { userId: true, homeStoreId: true } },
    },
  });
  if (!r || !r.documentContentType || !r.documentData)
    throw new DomainError('document_not_found', 404);
  return r;
}

export interface LeaveListFilter {
  scope: StoreScope;
  status?: string;
  employeeId?: string;
  employeeIds?: string[];
  typeId?: string;
  from?: string;
  to?: string;
  storeId?: string;
  departmentId?: string;
}

function listWhere(f: LeaveListFilter): Prisma.LeaveRequestWhereInput {
  const statusIn =
    f.status === 'pending'
      ? { in: [...PENDING] }
      : f.status &&
          ['pending_manager', 'pending_hr', 'approved', 'rejected', 'cancelled'].includes(f.status)
        ? (f.status as LeaveRequestStatus)
        : undefined;
  return {
    ...(statusIn && { status: statusIn }),
    ...(f.typeId && { typeId: f.typeId }),
    ...(f.from && { toDay: { gte: dayDate(f.from) } }),
    ...(f.to && { fromDay: { lte: dayDate(f.to) } }),
    employee: {
      ...(f.scope && { homeStoreId: { in: f.scope } }),
      ...(f.storeId && { homeStoreId: f.storeId }),
      ...(f.departmentId && { departmentId: f.departmentId }),
    },
    ...(f.employeeId && { employeeId: f.employeeId }),
    ...(f.employeeIds && { employeeId: { in: f.employeeIds } }),
  };
}

export async function listLeaveRequests(db: Db, f: LeaveListFilter) {
  const rows = await db.leaveRequest.findMany({
    where: listWhere(f),
    include: requestInclude,
    orderBy: [{ fromDay: 'desc' }, { number: 'desc' }],
    take: 500,
  });
  return rows.map(requestView);
}

/** One request with its days, the balance it draws on, who decided and its approver now. */
export async function leaveRequestDetail(
  db: Db,
  input: { requestId: string; scope: StoreScope | 'self' | 'team'; viewerUserId?: string },
) {
  const r = await db.leaveRequest.findUnique({
    where: { id: input.requestId },
    include: { ...requestInclude, dayRows: { orderBy: { day: 'asc' } } },
  });
  if (!r) throw new DomainError('leave_request_not_found', 404);
  if (input.scope === 'self') {
    if (r.employee.userId !== input.viewerUserId)
      throw new DomainError('leave_request_not_found', 404);
  } else if (input.scope === 'team') {
    const me = input.viewerUserId ? await actorFile(db, input.viewerUserId) : null;
    if (!me || !(await teamIds(db, me)).has(r.employeeId))
      throw new DomainError('not_your_team', 403);
  } else if (!inStoreScope(input.scope, r.employee.homeStoreId))
    throw new DomainError('store_not_allowed', 403);
  const startMonth = await getSetting(db, 'hr.leave_year_start_month');
  const [balances, manager, names] = await Promise.all([
    leaveBalances(db, {
      employeeId: r.employeeId,
      year: leaveYearOf(dayText(r.fromDay), startMonth),
    }),
    managerOf(db, r.employeeId),
    userNames(db, [
      r.requestedById,
      r.managerDecidedById,
      r.hrDecidedById,
      r.rejectedById,
      r.cancelledById,
    ]),
  ]);
  const people = await db.employee.findMany({
    where: { id: { in: [r.managerEmployeeId, manager.managerId].filter((x): x is string => !!x) } },
    select: { id: true, nameEn: true, nameAr: true, userId: true },
  });
  const person = (id: string | null) => people.find((p) => p.id === id) ?? null;
  const line =
    r.type.balance === 'annual' && !r.type.casualAllowance && r.type.yearlyDays === null
      ? null
      : balances.types.find((t) => t.type.id === r.typeId);
  return {
    ...requestView(r),
    dayRows: r.dayRows.map((d) => ({
      day: dayText(d.day),
      fraction: Number(d.fraction),
      paid: d.paid,
      inPayroll: !!d.payrollEntryId,
    })),
    requestedBy: names.get(r.requestedById) ?? null,
    managerDecidedBy: r.managerDecidedById ? (names.get(r.managerDecidedById) ?? null) : null,
    hrDecidedBy: r.hrDecidedById ? (names.get(r.hrDecidedById) ?? null) : null,
    rejectedBy: r.rejectedById ? (names.get(r.rejectedById) ?? null) : null,
    cancelledBy: r.cancelledById ? (names.get(r.cancelledById) ?? null) : null,
    manager: person(r.managerEmployeeId),
    managerNow: person(manager.managerId),
    balance: {
      year: balances.year,
      annual: r.type.balance === 'annual' ? balances.annual : null,
      line: line ?? null,
    },
  };
}
export type LeaveRequestDetail = Awaited<ReturnType<typeof leaveRequestDetail>>;

/** My HR: balances of the current leave year, the types I may ask for and my requests. */
export async function myLeave(db: Db, input: { userId: string; now?: Date }) {
  const employeeId = await ownFile(db, input.userId);
  const today = cairoDay(input.now ?? new Date());
  const [balances, requests, types] = await Promise.all([
    leaveBalances(db, { employeeId, asOf: today }),
    listLeaveRequests(db, { scope: null, employeeId }),
    listLeaveTypes(db, { activeOnly: true }),
  ]);
  return {
    employeeId,
    balances,
    requests,
    types: types.filter((t) => t.selfRequest),
    backdateDays: await getSetting(db, 'hr.leave_backdate_days'),
  };
}

/**
 * Who is off when: every approved (and waiting) leave day in a month for the people in scope,
 * filtered by department (with those below it) and store, or limited to a manager's team.
 */
export async function leaveCalendar(
  db: Db,
  input: {
    month: string;
    scope: StoreScope;
    storeId?: string;
    departmentId?: string;
    employeeIds?: string[];
  },
) {
  const from = `${input.month}-01`;
  const to = addDays(`${addDays(`${input.month}-28`, 4).slice(0, 7)}-01`, -1);
  let departments: string[] | undefined;
  if (input.departmentId) {
    const all = await db.department.findMany({ select: { id: true, parentId: true } });
    departments = [input.departmentId];
    for (let i = 0; i < departments.length; i++)
      for (const d of all) if (d.parentId === departments[i]) departments.push(d.id);
  }
  const rows = await db.leaveRequestDay.findMany({
    where: {
      day: { gte: dayDate(from), lte: dayDate(to) },
      request: { status: { in: [...LIVE] } },
      employee: {
        ...(input.scope && { homeStoreId: { in: input.scope } }),
        ...(input.storeId && { homeStoreId: input.storeId }),
        ...(departments && { departmentId: { in: departments } }),
      },
      ...(input.employeeIds && { employeeId: { in: input.employeeIds } }),
    },
    select: {
      day: true,
      fraction: true,
      requestId: true,
      request: {
        select: { status: true, type: { select: { code: true, nameEn: true, nameAr: true } } },
      },
      employee: {
        select: {
          id: true,
          number: true,
          nameEn: true,
          nameAr: true,
          homeStore: { select: { code: true } },
          department: { select: { nameEn: true, nameAr: true } },
        },
      },
    },
  });
  const holidays = await db.holiday.findMany({
    where: { day: { gte: dayDate(from), lte: dayDate(to) } },
  });
  const people = new Map<
    string,
    {
      employee: { id: string; code: string; nameEn: string; nameAr: string | null };
      store: string | null;
      department: { nameEn: string; nameAr: string } | null;
      days: Record<
        string,
        {
          requestId: string;
          status: 'approved' | 'pending';
          fraction: number;
          type: { code: string; nameEn: string; nameAr: string };
        }
      >;
      total: number;
    }
  >();
  for (const r of rows) {
    const p = people.get(r.employee.id) ?? {
      employee: {
        id: r.employee.id,
        code: employeeCode(r.employee.number),
        nameEn: r.employee.nameEn,
        nameAr: r.employee.nameAr,
      },
      store: r.employee.homeStore?.code ?? null,
      department: r.employee.department,
      days: {},
      total: 0,
    };
    const status = r.request.status === 'approved' ? 'approved' : 'pending';
    p.days[dayText(r.day)] = {
      requestId: r.requestId,
      status,
      fraction: Number(r.fraction),
      type: r.request.type,
    };
    if (status === 'approved') p.total = days2(p.total + Number(r.fraction));
    people.set(r.employee.id, p);
  }
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return {
    month: input.month,
    days,
    holidays: holidays.map((h) => dayText(h.day)),
    people: [...people.values()].sort((a, b) => a.employee.nameEn.localeCompare(b.employee.nameEn)),
  };
}

/** Unpaid leave days the salary run has not taken yet, up to a day (HR phase 3). */
export async function unpaidLeaveDaysFor(db: Db, employeeId: string, until: string) {
  return db.leaveRequestDay.findMany({
    where: {
      employeeId,
      paid: false,
      payrollEntryId: null,
      day: { lte: dayDate(until) },
      request: { status: 'approved' },
    },
    select: {
      id: true,
      day: true,
      fraction: true,
      request: { select: { number: true, type: { select: { nameEn: true } } } },
    },
    orderBy: { day: 'asc' },
  });
}

import type { AttendanceStatus, Prisma, PunchKind, PunchSource, Role } from '@prisma/client';
import {
  addDays,
  type AttendanceFlag,
  type BoardState,
  cairoAt,
  cairoDay,
  cairoDayStart,
  type ClockBody,
  type DayStatusBody,
  distanceMeters,
  employeeCode,
  formatMinute,
  type HolidayBody,
  type ManualPunchBody,
  parseMinute,
  type RosterCellBody,
  type ShiftBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { getSetting } from './settings';

// HR step 2 (docs/HR.md 2): shifts, the roster, official holidays, Clock in and Clock out with
// a location check, the daily close that turns the roster and the punches into attendance
// days, the Today board and managers' corrections. Every change is audited on the employee.

type Tx = Prisma.TransactionClient;
/** Store scope of the person asking: null is every store (docs/ACCESS.md). */
export type StoreScope = string[] | null;

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const minutesBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / 60_000);
const HOUR = 3_600_000;

function inScope(scope: StoreScope, storeId: string | null) {
  return scope === null || (storeId !== null && scope.includes(storeId));
}

// ─── shifts ────────────────────────────────────────────────────────────────────

type ShiftRow = Prisma.ShiftGetPayload<object>;

function shiftView(s: ShiftRow, employees = 0) {
  return {
    id: s.id,
    nameEn: s.nameEn,
    nameAr: s.nameAr,
    start: formatMinute(s.startMinute),
    end: formatMinute(s.endMinute),
    breakMinutes: s.breakMinutes,
    weekdays: [...s.weekdays].sort((a, b) => a - b),
    overnight: s.overnight,
    isActive: s.isActive,
    employees,
  };
}
export type ShiftView = ReturnType<typeof shiftView>;

function shiftData(body: ShiftBody) {
  const startMinute = parseMinute(body.start)!;
  const endMinute = parseMinute(body.end)!;
  if (endMinute === startMinute) throw new DomainError('shift_empty', 400);
  if (endMinute < startMinute && !body.overnight)
    throw new DomainError('shift_crosses_midnight', 400);
  return {
    nameEn: body.nameEn,
    nameAr: body.nameAr ?? null,
    startMinute,
    endMinute,
    breakMinutes: body.breakMinutes,
    weekdays: [...new Set(body.weekdays)].sort((a, b) => a - b),
    overnight: body.overnight,
    isActive: body.isActive ?? true,
  };
}

export async function listShifts(db: Db) {
  const rows = await db.shift.findMany({
    include: { _count: { select: { employees: true } } },
    orderBy: [{ isActive: 'desc' }, { startMinute: 'asc' }, { nameEn: 'asc' }],
  });
  return rows.map((s) => shiftView(s, s._count.employees));
}

export function createShift(db: Db, input: { body: ShiftBody; actorUserId: string; now?: Date }) {
  return inTransaction(db, async (tx) => {
    const shift = await tx.shift.create({ data: shiftData(input.body) });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'shift.create',
      entityType: 'shift',
      entityId: shift.id,
      after: shiftView(shift),
    });
    return shiftView(shift);
  });
}

/**
 * Changes a shift template. Days already planned keep their copied times, except the coming
 * days generated from it (not edited by hand): those are planned again from tomorrow.
 */
export function updateShift(
  db: Db,
  input: { shiftId: string; body: ShiftBody; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.shift.findUnique({ where: { id: input.shiftId } });
    if (!before) throw new DomainError('shift_not_found', 404);
    const shift = await tx.shift.update({
      where: { id: before.id },
      data: shiftData(input.body),
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'shift.update',
      entityType: 'shift',
      entityId: shift.id,
      before: shiftView(before),
      after: shiftView(shift),
    });
    const people = await tx.employee.findMany({
      where: { defaultShiftId: shift.id },
      select: { id: true },
    });
    await replanFuture(
      tx,
      people.map((p) => p.id),
      input.now ?? new Date(),
    );
    return shiftView(shift);
  });
}

// ─── holidays ──────────────────────────────────────────────────────────────────

const holidayView = (h: Prisma.HolidayGetPayload<object>) => ({
  id: h.id,
  day: dayText(h.day),
  nameEn: h.nameEn,
  nameAr: h.nameAr,
});

export async function listHolidays(db: Db, year?: number) {
  const rows = await db.holiday.findMany({
    where: year ? { day: { gte: dayDate(`${year}-01-01`), lte: dayDate(`${year}-12-31`) } } : {},
    orderBy: { day: 'asc' },
  });
  return rows.map(holidayView);
}

export function createHoliday(
  db: Db,
  input: { body: HolidayBody; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const exists = await tx.holiday.findUnique({ where: { day: dayDate(input.body.day) } });
    if (exists) throw new DomainError('holiday_exists');
    const h = await tx.holiday.create({
      data: { ...input.body, day: dayDate(input.body.day), createdById: input.actorUserId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'holiday.create',
      entityType: 'holiday',
      entityId: h.id,
      after: holidayView(h),
    });
    await recomputeDate(tx, input.body.day, input.now ?? new Date());
    return holidayView(h);
  });
}

export function deleteHoliday(
  db: Db,
  input: { holidayId: string; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const h = await tx.holiday.findUnique({ where: { id: input.holidayId } });
    if (!h) throw new DomainError('holiday_not_found', 404);
    await tx.holiday.delete({ where: { id: h.id } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'holiday.delete',
      entityType: 'holiday',
      entityId: h.id,
      before: holidayView(h),
    });
    await recomputeDate(tx, dayText(h.day), input.now ?? new Date());
    return { deleted: true };
  });
}

/** A holiday added or removed for a day already closed: its attendance days are built again. */
async function recomputeDate(tx: Tx, day: string, now: Date) {
  const rows = await tx.attendanceDay.findMany({
    where: { day: dayDate(day) },
    select: { employeeId: true },
  });
  for (const r of rows) await closeDayTx(tx, r.employeeId, day, now, { force: true });
}

// ─── roster ────────────────────────────────────────────────────────────────────

/** People who get a roster: everyone working for us (not left, not suspended). */
const PLANNED_STATUSES = ['active', 'on_leave'] as const;

/**
 * Plans `days` days from `from` for every person with a default shift (or the listed ones):
 * the shift's weekdays get the shift, the others a day off. Days already planned are kept,
 * so running it twice changes nothing.
 */
export async function generateRoster(
  db: Db,
  input: { from: string; days: number; employeeIds?: string[]; actorUserId?: string | null },
) {
  const people = await db.employee.findMany({
    where: {
      status: { in: [...PLANNED_STATUSES] },
      defaultShiftId: { not: null },
      defaultShift: { isActive: true },
      ...(input.employeeIds && { id: { in: input.employeeIds } }),
    },
    select: { id: true, homeStoreId: true, defaultShift: true },
  });
  const rows: Prisma.RosterDayCreateManyInput[] = [];
  for (const p of people) {
    const shift = p.defaultShift!;
    for (let i = 0; i < input.days; i++) {
      const day = addDays(input.from, i);
      const weekday = dayDate(day).getUTCDay();
      const works = shift.weekdays.includes(weekday);
      rows.push({
        employeeId: p.id,
        day: dayDate(day),
        darkStoreId: p.homeStoreId,
        shiftId: works ? shift.id : null,
        startMinute: works ? shift.startMinute : null,
        endMinute: works ? shift.endMinute : null,
        breakMinutes: works ? shift.breakMinutes : null,
        updatedById: input.actorUserId ?? null,
      });
    }
  }
  if (rows.length === 0) return { created: 0 };
  const created = await db.rosterDay.createMany({ data: rows, skipDuplicates: true });
  return { created: created.count };
}

/** The coming generated days of these people are planned again (edited days are kept). */
async function replanFuture(tx: Tx, employeeIds: string[], now: Date) {
  if (employeeIds.length === 0) return;
  const today = cairoDay(now);
  await tx.rosterDay.deleteMany({
    where: { employeeId: { in: employeeIds }, edited: false, day: { gt: dayDate(today) } },
  });
  await generateRoster(tx, { from: today, days: 14, employeeIds });
}

/** The person's default shift, which their roster is generated from. Audited. */
export function setDefaultShift(
  db: Db,
  input: {
    employeeId: string;
    shiftId: string | null;
    actorUserId: string;
    scope: StoreScope;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const e = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (!inScope(input.scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
    if (input.shiftId) {
      const shift = await tx.shift.findUnique({ where: { id: input.shiftId } });
      if (!shift || !shift.isActive) throw new DomainError('shift_not_found', 404);
    }
    if (e.defaultShiftId === input.shiftId) return { defaultShiftId: input.shiftId };
    await tx.employee.update({ where: { id: e.id }, data: { defaultShiftId: input.shiftId } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.default_shift',
      entityType: 'employee',
      entityId: e.id,
      before: { defaultShiftId: e.defaultShiftId },
      after: { defaultShiftId: input.shiftId },
    });
    const now = input.now ?? new Date();
    if (input.shiftId) await replanFuture(tx, [e.id], now);
    else
      await tx.rosterDay.deleteMany({
        where: { employeeId: e.id, edited: false, day: { gt: dayDate(cairoDay(now)) } },
      });
    return { defaultShiftId: input.shiftId };
  });
}

/** Saturday on or before `day`: the roster week runs Saturday to Friday. */
export function weekStart(day: string) {
  const weekday = dayDate(day).getUTCDay();
  return addDays(day, -((weekday + 1) % 7));
}

/**
 * One week of a store's roster (or the office's: storeId null, every store's people only).
 * Each cell is a shift with its times, a day off, or empty (not planned).
 */
export async function getRoster(
  db: Db,
  input: { storeId: string | null; week: string; scope: StoreScope },
) {
  if (!inScope(input.scope, input.storeId)) throw new DomainError('store_not_allowed', 403);
  const from = weekStart(input.week);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const people = await db.employee.findMany({
    where: { homeStoreId: input.storeId, status: { not: 'left' } },
    select: {
      id: true,
      number: true,
      nameEn: true,
      nameAr: true,
      status: true,
      defaultShiftId: true,
      user: { select: { role: true } },
      rosterDays: {
        where: { day: { gte: dayDate(days[0]!), lte: dayDate(days[6]!) } },
      },
    },
    orderBy: [{ nameEn: 'asc' }],
  });
  const [shifts, holidays, leave] = await Promise.all([
    listShifts(db),
    db.holiday.findMany({
      where: { day: { gte: dayDate(days[0]!), lte: dayDate(days[6]!) } },
    }),
    // Approved leave shows on the roster (HR phase 3).
    db.leaveRequestDay.findMany({
      where: {
        employeeId: { in: people.map((p) => p.id) },
        day: { gte: dayDate(days[0]!), lte: dayDate(days[6]!) },
        request: { status: 'approved' },
      },
      select: {
        employeeId: true,
        day: true,
        fraction: true,
        request: { select: { type: { select: { code: true, nameEn: true, nameAr: true } } } },
      },
    }),
  ]);
  const leaveOf = (employeeId: string, d: string) => {
    const l = leave.find((x) => x.employeeId === employeeId && dayText(x.day) === d);
    return l ? { fraction: Number(l.fraction), ...l.request.type } : null;
  };
  return {
    from,
    days,
    holidays: holidays.map(holidayView),
    shifts,
    people: people.map((p) => ({
      id: p.id,
      code: employeeCode(p.number),
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      role: p.user.role,
      status: p.status,
      defaultShiftId: p.defaultShiftId,
      leave: days.map((d) => leaveOf(p.id, d)),
      cells: days.map((d) => {
        const r = p.rosterDays.find((x) => dayText(x.day) === d);
        if (!r) return null;
        return {
          day: d,
          shiftId: r.shiftId,
          start: r.startMinute === null ? null : formatMinute(r.startMinute),
          end: r.endMinute === null ? null : formatMinute(r.endMinute),
          edited: r.edited,
        };
      }),
    })),
  };
}

/** Plans one day by hand: a shift or a day off. Audited; a closed day is built again. */
export function setRosterCell(
  db: Db,
  input: { body: RosterCellBody; actorUserId: string; scope: StoreScope; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const e = await tx.employee.findUnique({ where: { id: input.body.employeeId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (!inScope(input.scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
    const shift = input.body.shiftId
      ? await tx.shift.findUnique({ where: { id: input.body.shiftId } })
      : null;
    if (input.body.shiftId && (!shift || !shift.isActive))
      throw new DomainError('shift_not_found', 404);
    const where = { employeeId_day: { employeeId: e.id, day: dayDate(input.body.day) } };
    const before = await tx.rosterDay.findUnique({ where });
    const data = {
      shiftId: shift?.id ?? null,
      startMinute: shift?.startMinute ?? null,
      endMinute: shift?.endMinute ?? null,
      breakMinutes: shift?.breakMinutes ?? null,
      darkStoreId: before?.darkStoreId ?? e.homeStoreId,
      edited: true,
      updatedById: input.actorUserId,
    };
    await tx.rosterDay.upsert({
      where,
      create: { employeeId: e.id, day: dayDate(input.body.day), ...data },
      update: data,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'roster.set',
      entityType: 'employee',
      entityId: e.id,
      before: before
        ? { day: input.body.day, shiftId: before.shiftId, startMinute: before.startMinute }
        : { day: input.body.day },
      after: { day: input.body.day, shiftId: data.shiftId, startMinute: data.startMinute },
    });
    if (await tx.attendanceDay.findUnique({ where }))
      await closeDayTx(tx, e.id, input.body.day, now, { force: true });
    return { day: input.body.day, shiftId: data.shiftId };
  });
}

// ─── seed and demo ─────────────────────────────────────────────────────────────

/**
 * The stores open 10:00 to 22:00, covered by two shifts with one day off each (Friday for the
 * morning, Thursday for the evening). Created only while there is no shift at all.
 */
export const DEFAULT_SHIFTS = [
  {
    nameEn: 'Morning',
    nameAr: 'صباحي',
    startMinute: 600,
    endMinute: 960,
    weekdays: [0, 1, 2, 3, 4, 6],
  },
  {
    nameEn: 'Evening',
    nameAr: 'مسائي',
    startMinute: 960,
    endMinute: 1320,
    weekdays: [0, 1, 2, 3, 5, 6],
  },
] as const;

/**
 * Seed and demo: creates the default shifts when there are none, gives store staff and riders
 * without a default shift one of them (alternating within each store, never for a person whose
 * shift HR already set or cleared) and plans the coming two weeks. Running it again changes
 * nothing.
 */
export async function ensureStoreShifts(db: Db, today: string) {
  let created = 0;
  if ((await db.shift.count()) === 0) {
    for (const s of DEFAULT_SHIFTS) {
      await db.shift.create({
        data: {
          nameEn: s.nameEn,
          nameAr: s.nameAr,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
          breakMinutes: 30,
          weekdays: [...s.weekdays],
        },
      });
      created++;
    }
  }
  const shifts = await db.shift.findMany({
    where: { isActive: true, nameEn: { in: DEFAULT_SHIFTS.map((s) => s.nameEn) } },
    orderBy: { startMinute: 'asc' },
  });
  if (shifts.length === 0) return { created, assigned: 0 };
  const touched = await db.auditLog.findMany({
    where: { action: 'employee.default_shift' },
    select: { entityId: true },
  });
  const skip = new Set(touched.map((t) => t.entityId));
  const people = await db.employee.findMany({
    where: {
      defaultShiftId: null,
      status: 'active',
      homeStoreId: { not: null },
      user: { role: { in: ['store_staff', 'rider'] } },
    },
    select: { id: true, homeStoreId: true },
    orderBy: [{ homeStoreId: 'asc' }, { number: 'asc' }],
  });
  const perStore = new Map<string, number>();
  const assigned: string[] = [];
  for (const p of people) {
    if (skip.has(p.id)) continue;
    const n = perStore.get(p.homeStoreId!) ?? 0;
    perStore.set(p.homeStoreId!, n + 1);
    const shift = shifts[n % shifts.length]!;
    await db.employee.update({ where: { id: p.id }, data: { defaultShiftId: shift.id } });
    assigned.push(p.id);
  }
  if (assigned.length) await generateRoster(db, { from: today, days: 14, employeeIds: assigned });
  return { created, assigned: assigned.length };
}

// ─── the day's plan and its punches ────────────────────────────────────────────

interface Plan {
  shiftId: string | null;
  start: Date;
  end: Date;
  breakMinutes: number;
}
type RosterRow = Prisma.RosterDayGetPayload<object>;

function planOf(row: RosterRow | undefined | null): Plan | null {
  if (!row || row.shiftId === null || row.startMinute === null || row.endMinute === null)
    return null;
  const day = dayText(row.day);
  const endMinute = row.endMinute <= row.startMinute ? row.endMinute + 1440 : row.endMinute;
  return {
    shiftId: row.shiftId,
    start: cairoAt(day, row.startMinute),
    end: cairoAt(day, endMinute),
    breakMinutes: row.breakMinutes ?? 0,
  };
}

interface PunchLite {
  id: string;
  kind: PunchKind;
  at: Date;
  source: PunchSource;
}
interface Session {
  in: PunchLite;
  out: PunchLite | null;
}

/** In, out, in, out...: a second in while one is open, or an out without one, is ignored. */
function pairSessions(punches: PunchLite[]): Session[] {
  const sessions: Session[] = [];
  let open: Session | null = null;
  for (const p of [...punches].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (p.kind === 'in') {
      if (!open) open = { in: p, out: null };
    } else if (open) {
      open.out = p;
      sessions.push(open);
      open = null;
    }
  }
  if (open) sessions.push(open);
  return sessions;
}

/**
 * The day a session belongs to: the Cairo day of its clock in, or the day before when that
 * day's shift runs past midnight and has not ended yet (an overnight shift).
 */
function sessionDay(inAt: Date, plans: Map<string, Plan | null>) {
  const day = cairoDay(inAt);
  const before = plans.get(addDays(day, -1));
  if (before && before.end > cairoDayStart(day) && inAt < before.end) return addDays(day, -1);
  return day;
}

interface DayContext {
  employee: { id: string; status: string; homeStoreId: string | null; leftOn: Date | null };
  row: RosterRow | null;
  plan: Plan | null;
  holiday: boolean;
  /** Approved leave on the day (HR phase 3): 1 a full day, 0.5 a half day, 0 none */
  leave: number;
  sessions: Session[];
  /** Every punch read around the day (also voided ones), for the detail screen */
  punches: Prisma.PunchGetPayload<object>[];
}

async function loadDay(db: Db, employeeId: string, day: string): Promise<DayContext> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, status: true, homeStoreId: true, leftOn: true },
  });
  if (!employee) throw new DomainError('employee_not_found', 404);
  const rows = await db.rosterDay.findMany({
    where: {
      employeeId,
      day: { gte: dayDate(addDays(day, -1)), lte: dayDate(addDays(day, 1)) },
    },
  });
  const plans = new Map<string, Plan | null>();
  for (const r of rows) plans.set(dayText(r.day), planOf(r));
  const punches = await db.punch.findMany({
    where: {
      employeeId,
      at: { gte: cairoDayStart(addDays(day, -1)), lt: cairoDayStart(addDays(day, 2)) },
    },
    orderBy: { at: 'asc' },
  });
  const valid = punches.filter((p) => !p.voidedAt);
  const sessions = pairSessions(valid).filter((s) => sessionDay(s.in.at, plans) === day);
  const row = rows.find((r) => dayText(r.day) === day) ?? null;
  const holiday = !!(await db.holiday.findUnique({ where: { day: dayDate(day) } }));
  const leave = await leaveFractionOn(db, employeeId, day);
  return { employee, row, plan: planOf(row), holiday, leave, sessions, punches };
}

/**
 * Approved leave on a day (HR phase 3): the largest fraction of an approved request's day
 * row (a full day 1, a half day 0.5), else 0.
 */
export async function leaveFractionOn(db: Db, employeeId: string, day: string) {
  const rows = await db.leaveRequestDay.findMany({
    where: { employeeId, day: dayDate(day), request: { status: 'approved' } },
    select: { fraction: true },
  });
  return rows.reduce((max, r) => Math.max(max, Number(r.fraction)), 0);
}

/**
 * On leave: the file says so, or approved leave covers the day (a half day only when the
 * person did not come in; otherwise the worked half is judged as usual).
 */
function isOnLeave(ctx: { employee: { status: string }; leave: number; sessions: Session[] }) {
  if (ctx.employee.status === 'on_leave') return true;
  return ctx.leave >= 1 || (ctx.leave > 0 && ctx.sessions.length === 0);
}

interface Rules {
  grace: number;
  overtimeAfter: number;
}

/** What a day comes to: the status and its minutes. Pure, so tests can call it directly. */
export function computeAttendance(input: {
  plan: Plan | null;
  planned: boolean;
  holiday: boolean;
  onLeave: boolean;
  sessions: Session[];
  rules: Rules;
}) {
  const closed = input.sessions.filter((s) => s.out);
  const total = closed.reduce((sum, s) => sum + minutesBetween(s.in.at, s.out!.at), 0);
  const firstIn = input.sessions[0]?.in.at ?? null;
  const lastOut = closed.length ? closed[closed.length - 1]!.out!.at : null;
  const flags = new Set<AttendanceFlag>();
  for (const s of input.sessions) {
    if (s.out?.source === 'auto') flags.add('forgot_clock_out');
    if (s.in.source === 'manual' || s.out?.source === 'manual') flags.add('manual_punch');
  }
  const result = {
    status: 'present' as AttendanceStatus,
    firstIn,
    lastOut,
    lateMinutes: 0,
    earlyMinutes: 0,
    overtimeMinutes: 0,
    workedMinutes: Math.max(0, total - (input.plan && total > 0 ? input.plan.breakMinutes : 0)),
    flags: [...flags] as string[],
  };
  if (input.onLeave) return { ...result, status: 'on_leave' as const };
  if (input.holiday || (!input.plan && input.planned)) {
    // Work on a holiday or a day off is overtime, all of it.
    return {
      ...result,
      status: input.holiday ? ('holiday' as const) : ('day_off' as const),
      overtimeMinutes: result.workedMinutes,
    };
  }
  if (!input.plan) return result; // worked without a plan: present
  if (input.sessions.length === 0) return { ...result, status: 'absent' as const };
  const late = Math.max(0, minutesBetween(input.plan.start, firstIn!));
  const early = lastOut ? Math.max(0, minutesBetween(lastOut, input.plan.end)) : 0;
  const after = lastOut ? Math.max(0, minutesBetween(input.plan.end, lastOut)) : 0;
  const status: AttendanceStatus =
    late > input.rules.grace ? 'late' : early > input.rules.grace ? 'left_early' : 'present';
  return {
    ...result,
    status,
    lateMinutes: late,
    earlyMinutes: early,
    overtimeMinutes: after >= input.rules.overtimeAfter ? after : 0,
  };
}

async function rulesOf(db: Db): Promise<Rules> {
  return {
    grace: await getSetting(db, 'hr.late_grace_minutes'),
    overtimeAfter: await getSetting(db, 'hr.overtime_after_minutes'),
  };
}

/** When a day may be closed: its shift end plus hr.auto_close_hours, and never before it ends. */
function closeAt(day: string, plan: Plan | null, autoCloseHours: number) {
  const dayEnd = cairoDayStart(addDays(day, 1));
  const at = new Date((plan?.end ?? dayEnd).getTime() + autoCloseHours * HOUR);
  return at > dayEnd ? at : dayEnd;
}

/**
 * Closes (or, with force, builds again) one person's attendance day. A person still clocked
 * in is clocked out at the shift end (or at the clock in without a shift) and flagged
 * forgot_clock_out. A manager's status is kept. Returns null when the day is not over yet.
 */
async function closeDayTx(
  tx: Tx,
  employeeId: string,
  day: string,
  now: Date,
  options: { force?: boolean; actorUserId?: string | null } = {},
) {
  // One close at a time per person, so two instances never add two automatic punches.
  await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;
  const where = { employeeId_day: { employeeId, day: dayDate(day) } };
  const existing = await tx.attendanceDay.findUnique({ where });
  if (existing && !options.force) return existing;
  let ctx = await loadDay(tx, employeeId, day);
  const due = now >= closeAt(day, ctx.plan, await getSetting(tx, 'hr.auto_close_hours'));
  if (!due && !existing) return null;
  if (!ctx.row && ctx.sessions.length === 0 && !existing) return null;
  if (ctx.employee.leftOn && dayText(ctx.employee.leftOn) < day && ctx.sessions.length === 0)
    return null;

  const open = ctx.sessions.find((s) => !s.out);
  if (open && due) {
    const at = ctx.plan && ctx.plan.end > open.in.at ? ctx.plan.end : open.in.at;
    const punch = await tx.punch.create({
      data: {
        employeeId,
        kind: 'out',
        at,
        source: 'auto',
        reason: 'forgot_clock_out',
        darkStoreId: ctx.employee.homeStoreId,
      },
    });
    await recordAudit(tx, {
      actorUserId: null,
      action: 'attendance.auto_clock_out',
      entityType: 'employee',
      entityId: employeeId,
      after: { punchId: punch.id, day, at: at.toISOString() },
    });
    ctx = await loadDay(tx, employeeId, day);
  }
  const computed = computeAttendance({
    plan: ctx.plan,
    planned: !!ctx.row,
    holiday: ctx.holiday,
    onLeave: isOnLeave(ctx),
    sessions: ctx.sessions,
    rules: await rulesOf(tx),
  });
  const override = existing?.overrideStatus ?? null;
  const flags = new Set(computed.flags);
  if (override) flags.add('corrected');
  const data = {
    darkStoreId: ctx.row?.darkStoreId ?? ctx.employee.homeStoreId,
    shiftId: ctx.plan?.shiftId ?? null,
    plannedStart: ctx.plan?.start ?? null,
    plannedEnd: ctx.plan?.end ?? null,
    status: override ?? computed.status,
    computedStatus: computed.status,
    firstIn: computed.firstIn,
    lastOut: computed.lastOut,
    lateMinutes: computed.lateMinutes,
    earlyMinutes: computed.earlyMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    workedMinutes: computed.workedMinutes,
    flags: [...flags],
  };
  return tx.attendanceDay.upsert({
    where,
    create: { employeeId, day: dayDate(day), ...data, closedAt: now },
    update: data,
  });
}

/** Closes (or builds again) one day in its own transaction. */
export function closeAttendanceDay(
  db: Db,
  input: { employeeId: string; day: string; now?: Date; force?: boolean },
) {
  return inTransaction(db, (tx) =>
    closeDayTx(tx, input.employeeId, input.day, input.now ?? new Date(), {
      force: input.force,
    }),
  );
}

/**
 * Builds again the closed days of a person among `days` (leave approved or cancelled, HR phase
 * 3). Days not closed yet are left to the daily close.
 */
export async function rebuildAttendanceDays(tx: Tx, employeeId: string, days: string[], now: Date) {
  if (days.length === 0) return 0;
  const closed = await tx.attendanceDay.findMany({
    where: { employeeId, day: { in: days.map(dayDate) } },
    select: { day: true },
  });
  for (const c of closed) await closeDayTx(tx, employeeId, dayText(c.day), now, { force: true });
  return closed.length;
}

/**
 * The daily close (run by the API's jobs, safe to run twice): plans the coming two weeks from
 * the default shifts, then closes every day of the last `lookbackDays` that is over and not
 * closed yet, for everyone planned or who clocked in.
 */
export async function closeAttendanceDays(db: Db, now: Date = new Date(), lookbackDays = 7) {
  const today = cairoDay(now);
  const planned = await generateRoster(db, { from: today, days: 14 });
  const from = addDays(today, -lookbackDays);
  const [rows, ins, closed] = await Promise.all([
    db.rosterDay.findMany({
      where: { day: { gte: dayDate(from), lte: dayDate(today) } },
      select: { employeeId: true, day: true },
    }),
    db.punch.findMany({
      where: { kind: 'in', voidedAt: null, at: { gte: cairoDayStart(from), lte: now } },
      select: { employeeId: true, at: true },
    }),
    db.attendanceDay.findMany({
      where: { day: { gte: dayDate(from), lte: dayDate(today) } },
      select: { employeeId: true, day: true },
    }),
  ]);
  const done = new Set(closed.map((c) => `${c.employeeId}|${dayText(c.day)}`));
  const todo = new Set<string>();
  for (const r of rows) todo.add(`${r.employeeId}|${dayText(r.day)}`);
  for (const p of ins) todo.add(`${p.employeeId}|${cairoDay(p.at)}`);
  let count = 0;
  for (const key of [...todo].sort()) {
    if (done.has(key)) continue;
    const [employeeId, day] = key.split('|') as [string, string];
    const result = await closeAttendanceDay(db, { employeeId, day, now });
    if (result) count++;
  }
  return { planned: planned.created, closed: count };
}

// ─── Clock in and Clock out ────────────────────────────────────────────────────

/** The place a person clocks in at: their store, else the office (settings). */
async function placeOf(db: Db, homeStoreId: string | null) {
  if (homeStoreId) {
    const store = await db.darkStore.findUnique({ where: { id: homeStoreId } });
    if (store)
      return {
        kind: 'store' as const,
        storeId: store.id,
        nameEn: store.nameEn,
        nameAr: store.nameAr,
        lat: store.latitude,
        lng: store.longitude,
        radiusM: await getSetting(db, 'hr.clock_radius_m', store.id),
      };
  }
  const lat = await getSetting(db, 'hr.office_lat');
  const lng = await getSetting(db, 'hr.office_lng');
  return {
    kind: 'office' as const,
    storeId: null,
    nameEn: null,
    nameAr: null,
    lat,
    lng,
    radiusM: await getSetting(db, 'hr.clock_radius_m'),
    notSet: lat === 0 && lng === 0,
  };
}

async function lastPunch(db: Db, employeeId: string) {
  return db.punch.findFirst({
    where: { employeeId, voidedAt: null },
    orderBy: [{ at: 'desc' }, { createdAt: 'desc' }],
  });
}

/** Whether the person behind this account is clocked in right now. */
export async function isClockedIn(db: Db, userId: string) {
  const e = await db.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!e) return false;
  return (await lastPunch(db, e.id))?.kind === 'in';
}

/**
 * Clock in or out from the person's phone. Refused without a position (no_position), with a
 * position less accurate than hr.max_accuracy_m (position_inaccurate), or farther than
 * hr.clock_radius_m from their store, or the office for office staff (too_far, with the
 * distance); a second clock in (already_clocked_in) or an out without an in (not_clocked_in).
 */
export function clockPunch(
  db: Db,
  input: {
    userId: string;
    kind: PunchKind;
    position: Partial<ClockBody> | null;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const e = await tx.employee.findUnique({ where: { userId: input.userId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (e.status === 'left' || e.status === 'suspended')
      throw new DomainError('employee_not_active', 403);
    const pos = input.position;
    if (
      !pos ||
      typeof pos.lat !== 'number' ||
      typeof pos.lng !== 'number' ||
      typeof pos.accuracy !== 'number' ||
      !Number.isFinite(pos.lat) ||
      !Number.isFinite(pos.lng)
    )
      throw new DomainError('no_position', 400);
    const maxAccuracy = await getSetting(tx, 'hr.max_accuracy_m');
    const accuracyM = Math.round(pos.accuracy);
    if (accuracyM > maxAccuracy)
      throw new DomainError('position_inaccurate', 400, { accuracyM, maxAccuracyM: maxAccuracy });
    const place = await placeOf(tx, e.homeStoreId);
    if (place.kind === 'office' && place.notSet)
      throw new DomainError('office_location_not_set', 409);
    const distanceM = distanceMeters({ lat: pos.lat, lng: pos.lng }, place);
    if (distanceM > place.radiusM)
      throw new DomainError('too_far', 403, { distanceM, radiusM: place.radiusM });

    await tx.$queryRaw`SELECT id FROM employees WHERE id = ${e.id} FOR UPDATE`;
    // Yesterday may still be open (a forgotten clock out): close it first when it is over.
    if (input.kind === 'in') await closeDayTx(tx, e.id, addDays(cairoDay(now), -1), now);
    const last = await lastPunch(tx, e.id);
    if (input.kind === 'in' && last?.kind === 'in')
      throw new DomainError('already_clocked_in', 409);
    if (input.kind === 'out' && last?.kind !== 'in') throw new DomainError('not_clocked_in', 409);
    const punch = await tx.punch.create({
      data: {
        employeeId: e.id,
        kind: input.kind,
        at: now,
        latitude: pos.lat,
        longitude: pos.lng,
        accuracyM,
        distanceM,
        darkStoreId: place.storeId,
        device: pos.device?.slice(0, 300) || null,
        source: 'app',
        byUserId: input.userId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.userId,
      action: input.kind === 'in' ? 'attendance.clock_in' : 'attendance.clock_out',
      entityType: 'employee',
      entityId: e.id,
      after: {
        punchId: punch.id,
        at: now.toISOString(),
        distanceM,
        accuracyM,
        storeId: place.storeId,
      },
    });
    await refreshAround(tx, e.id, now, now);
    return { id: punch.id, kind: punch.kind, at: punch.at, distanceM };
  });
}

/**
 * A punch from a field app that checks the person in its own way (docs/MERGE.md "One
 * structure"): Shiply's courier check in (photo and position at the hub) clocks the courier in,
 * a run leaving clocks them in when they are not, and the hub closing their last run clocks
 * them out. Nothing happens for a person without an active employee file, or when the punch
 * would repeat the last one, so callers may call it freely inside their own transaction.
 */
export async function fieldPunch(
  tx: Tx,
  input: {
    userId: string;
    kind: PunchKind;
    at: Date;
    lat?: number | null;
    lng?: number | null;
    /** Who caused it when not the person (the hub staff closing the run) */
    byUserId?: string;
    reason: string;
  },
) {
  const e = await tx.employee.findUnique({ where: { userId: input.userId } });
  if (!e || e.status === 'left' || e.status === 'suspended') return null;
  await tx.$queryRaw`SELECT id FROM employees WHERE id = ${e.id} FOR UPDATE`;
  if (input.kind === 'in') await closeDayTx(tx, e.id, addDays(cairoDay(input.at), -1), input.at);
  const last = await lastPunch(tx, e.id);
  if (input.kind === 'in' && last?.kind === 'in') return null;
  if (input.kind === 'out' && last?.kind !== 'in') return null;
  const punch = await tx.punch.create({
    data: {
      employeeId: e.id,
      kind: input.kind,
      at: input.at,
      latitude: input.lat ?? null,
      longitude: input.lng ?? null,
      source: input.byUserId && input.byUserId !== input.userId ? 'manual' : 'app',
      reason: input.reason,
      byUserId: input.byUserId ?? input.userId,
    },
  });
  await recordAudit(tx, {
    actorUserId: input.byUserId ?? input.userId,
    action: input.kind === 'in' ? 'attendance.clock_in' : 'attendance.clock_out',
    entityType: 'employee',
    entityId: e.id,
    after: { punchId: punch.id, at: input.at.toISOString(), reason: input.reason },
  });
  await refreshAround(tx, e.id, input.at, input.at);
  return punch;
}

/** After a punch changes, days around it that are already closed are built again. */
async function refreshAround(tx: Tx, employeeId: string, at: Date, now: Date) {
  const day = cairoDay(at);
  for (const d of [addDays(day, -1), day]) {
    const exists = await tx.attendanceDay.findUnique({
      where: { employeeId_day: { employeeId, day: dayDate(d) } },
    });
    if (exists) await closeDayTx(tx, employeeId, d, now, { force: true });
    else if (d < cairoDay(now)) await closeDayTx(tx, employeeId, d, now);
  }
}

// ─── what people see ───────────────────────────────────────────────────────────

const dayRowView = (d: Prisma.AttendanceDayGetPayload<object>) => ({
  day: dayText(d.day),
  status: d.status,
  computedStatus: d.computedStatus,
  overrideStatus: d.overrideStatus,
  plannedStart: d.plannedStart,
  plannedEnd: d.plannedEnd,
  firstIn: d.firstIn,
  lastOut: d.lastOut,
  lateMinutes: d.lateMinutes,
  earlyMinutes: d.earlyMinutes,
  overtimeMinutes: d.overtimeMinutes,
  workedMinutes: d.workedMinutes,
  flags: d.flags,
  correctionReason: d.correctionReason,
});
export type AttendanceDayView = ReturnType<typeof dayRowView>;

/** Today as it stands for one person (live, not closed yet). */
async function liveToday(db: Db, employeeId: string, now: Date) {
  const today = cairoDay(now);
  const ctx = await loadDay(db, employeeId, today);
  const last = await lastPunch(db, employeeId);
  const clockedIn = last?.kind === 'in';
  const firstIn = ctx.sessions[0]?.in.at ?? null;
  const worked = ctx.sessions.reduce(
    (sum, s) => sum + minutesBetween(s.in.at, s.out?.at ?? now),
    0,
  );
  return {
    day: today,
    shift: ctx.plan ? { start: ctx.plan.start, end: ctx.plan.end } : null,
    dayOff: !!ctx.row && !ctx.plan,
    holiday: ctx.holiday,
    clockedIn,
    since: clockedIn ? last!.at : null,
    firstIn,
    lastOut: !clockedIn && ctx.sessions.length ? (ctx.sessions.at(-1)!.out?.at ?? null) : null,
    lateMinutes: ctx.plan && firstIn ? Math.max(0, minutesBetween(ctx.plan.start, firstIn)) : null,
    workedMinutes: worked,
  };
}

/** My HR and the Clock in card: today, the place to clock in at and the month's closed days. */
export async function myAttendance(db: Db, input: { userId: string; now?: Date; month?: string }) {
  const now = input.now ?? new Date();
  const e = await db.employee.findUnique({ where: { userId: input.userId } });
  if (!e) throw new DomainError('employee_not_found', 404);
  const month = input.month ?? cairoDay(now).slice(0, 7);
  const first = `${month}-01`;
  const next = addDays(`${month}-28`, 4).slice(0, 7);
  const [today, place, days, grace, maxAccuracy] = await Promise.all([
    liveToday(db, e.id, now),
    placeOf(db, e.homeStoreId),
    db.attendanceDay.findMany({
      where: { employeeId: e.id, day: { gte: dayDate(first), lt: dayDate(`${next}-01`) } },
      orderBy: { day: 'desc' },
    }),
    getSetting(db, 'hr.late_grace_minutes'),
    getSetting(db, 'hr.max_accuracy_m'),
  ]);
  return {
    employeeId: e.id,
    today: { ...today, late: (today.lateMinutes ?? 0) > grace },
    place: {
      kind: place.kind,
      nameEn: place.nameEn,
      nameAr: place.nameAr,
      radiusM: place.radiusM,
      maxAccuracyM: maxAccuracy,
      ready: place.kind === 'store' || !place.notSet,
    },
    month,
    days: days.map(dayRowView),
  };
}

/**
 * The Today board of a store (or every store in scope): who is in, late, missing, on leave,
 * off or on holiday, from today's roster and punches.
 */
export async function attendanceBoard(
  db: Db,
  input: {
    scope: StoreScope;
    storeId?: string | null;
    /** One company's field team: Shiply's hub staff and couriers, or everyone else */
    team?: 'shiply' | 'shiply_now';
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const today = cairoDay(now);
  const shiplyRoles: Role[] = ['hub_staff', 'courier'];
  const teamFilter =
    input.team === 'shiply'
      ? { user: { role: { in: shiplyRoles } } }
      : input.team === 'shiply_now'
        ? { user: { role: { notIn: shiplyRoles } } }
        : {};
  if (input.storeId && !inScope(input.scope, input.storeId))
    throw new DomainError('store_not_allowed', 403);
  const storeFilter = input.storeId
    ? input.storeId
    : input.scope === null
      ? undefined
      : { in: input.scope };
  const people = await db.employee.findMany({
    where: { status: { not: 'left' }, homeStoreId: storeFilter, ...teamFilter },
    select: {
      id: true,
      number: true,
      nameEn: true,
      nameAr: true,
      status: true,
      homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      hub: { select: { id: true, code: true, name: true } },
      user: { select: { role: true, isActive: true } },
    },
    orderBy: { nameEn: 'asc' },
  });
  const ids = people.map((p) => p.id);
  const [rows, punches, holiday, grace] = await Promise.all([
    db.rosterDay.findMany({
      where: {
        employeeId: { in: ids },
        day: { gte: dayDate(addDays(today, -1)), lte: dayDate(today) },
      },
    }),
    db.punch.findMany({
      where: {
        employeeId: { in: ids },
        voidedAt: null,
        at: { gte: cairoDayStart(addDays(today, -1)), lte: now },
      },
      orderBy: { at: 'asc' },
    }),
    db.holiday.findUnique({ where: { day: dayDate(today) } }),
    getSetting(db, 'hr.late_grace_minutes'),
  ]);
  const leaveToday = new Set(
    (
      await db.leaveRequestDay.findMany({
        where: { employeeId: { in: ids }, day: dayDate(today), request: { status: 'approved' } },
        select: { employeeId: true },
      })
    ).map((l) => l.employeeId),
  );
  const board = people.map((p) => {
    const mine = rows.filter((r) => r.employeeId === p.id);
    const plans = new Map<string, Plan | null>();
    for (const r of mine) plans.set(dayText(r.day), planOf(r));
    const row = mine.find((r) => dayText(r.day) === today) ?? null;
    const plan = planOf(row);
    const myPunches = punches.filter((x) => x.employeeId === p.id);
    const sessions = pairSessions(myPunches).filter((s) => sessionDay(s.in.at, plans) === today);
    const clockedIn = myPunches.at(-1)?.kind === 'in';
    const firstIn = sessions[0]?.in.at ?? null;
    const late = plan && firstIn ? Math.max(0, minutesBetween(plan.start, firstIn)) : 0;
    let state: BoardState;
    if (p.status === 'on_leave' || (leaveToday.has(p.id) && !clockedIn && !sessions.length))
      state = 'on_leave';
    else if (clockedIn) state = late > grace ? 'late_in' : 'in';
    else if (sessions.length > 0) state = 'left';
    else if (holiday) state = 'holiday';
    else if (plan)
      state = now.getTime() > plan.start.getTime() + grace * 60_000 ? 'missing' : 'not_yet';
    else state = row ? 'day_off' : 'unplanned';
    return {
      employee: {
        id: p.id,
        code: employeeCode(p.number),
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        role: p.user.role,
        status: p.status,
      },
      store: p.homeStore,
      hub: p.hub,
      shift: plan ? { start: plan.start, end: plan.end } : null,
      state,
      firstIn,
      lastOut: !clockedIn && sessions.length ? (sessions.at(-1)!.out?.at ?? null) : null,
      lateMinutes: late,
      missingMinutes:
        state === 'missing' && plan ? Math.max(0, minutesBetween(plan.start, now)) : 0,
    };
  });
  const counts: Record<string, number> = {};
  for (const b of board) counts[b.state] = (counts[b.state] ?? 0) + 1;
  return { day: today, holiday: holiday ? holidayView(holiday) : null, counts, people: board };
}

export interface AttendanceDayFilter {
  scope: StoreScope;
  storeId?: string;
  employeeId?: string;
  status?: AttendanceStatus;
  from: string;
  to: string;
}

/** Closed attendance days with filters (also the CSV export). */
export async function listAttendanceDays(db: Db, f: AttendanceDayFilter) {
  const storeIn =
    f.scope === null
      ? f.storeId || undefined
      : { in: f.storeId ? f.scope.filter((s) => s === f.storeId) : f.scope };
  const rows = await db.attendanceDay.findMany({
    where: {
      day: { gte: dayDate(f.from), lte: dayDate(f.to) },
      darkStoreId: storeIn,
      employeeId: f.employeeId || undefined,
      status: f.status,
    },
    include: {
      employee: { select: { id: true, number: true, nameEn: true, nameAr: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
    orderBy: [{ day: 'desc' }, { employee: { nameEn: 'asc' } }],
    take: 3000,
  });
  return rows.map((r) => ({
    id: r.id,
    employee: {
      id: r.employee.id,
      code: employeeCode(r.employee.number),
      nameEn: r.employee.nameEn,
      nameAr: r.employee.nameAr,
    },
    store: r.darkStore,
    ...dayRowView(r),
  }));
}

/** One person's day: the plan, every punch around it (voided ones too) and the closed row. */
export async function attendanceDayDetail(
  db: Db,
  input: { employeeId: string; day: string; scope: StoreScope; now?: Date },
) {
  const now = input.now ?? new Date();
  const e = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, number: true, nameEn: true, nameAr: true, homeStoreId: true },
  });
  if (!e) throw new DomainError('employee_not_found', 404);
  if (!inScope(input.scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
  const ctx = await loadDay(db, e.id, input.day);
  const row = await db.attendanceDay.findUnique({
    where: { employeeId_day: { employeeId: e.id, day: dayDate(input.day) } },
  });
  const inDay = new Set(ctx.sessions.flatMap((s) => [s.in.id, s.out?.id]).filter(Boolean));
  const preview = computeAttendance({
    plan: ctx.plan,
    planned: !!ctx.row,
    holiday: ctx.holiday,
    onLeave: false,
    sessions: ctx.sessions,
    rules: await rulesOf(db),
  });
  return {
    employee: { id: e.id, code: employeeCode(e.number), nameEn: e.nameEn, nameAr: e.nameAr },
    day: input.day,
    closed: !!row,
    canCorrect: input.day <= cairoDay(now),
    plan: ctx.plan ? { start: ctx.plan.start, end: ctx.plan.end } : null,
    dayOff: !!ctx.row && !ctx.plan,
    holiday: ctx.holiday,
    row: row ? dayRowView(row) : null,
    preview: { status: preview.status, workedMinutes: preview.workedMinutes },
    punches: ctx.punches
      .filter((p) => inDay.has(p.id) || (p.voidedAt && cairoDay(p.at) === input.day))
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        at: p.at,
        source: p.source,
        distanceM: p.distanceM,
        accuracyM: p.accuracyM,
        reason: p.reason,
        voided: !!p.voidedAt,
        voidReason: p.voidReason,
      })),
  };
}

// ─── corrections ───────────────────────────────────────────────────────────────

/** A manager adds a punch the phone could not make. Audited; the day is built again. */
export function addManualPunch(
  db: Db,
  input: { body: ManualPunchBody; actorUserId: string; scope: StoreScope; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const at = new Date(input.body.at);
    if (at > now) throw new DomainError('punch_in_future', 400);
    const e = await tx.employee.findUnique({ where: { id: input.body.employeeId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (!inScope(input.scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
    await tx.$queryRaw`SELECT id FROM employees WHERE id = ${e.id} FOR UPDATE`;
    const punch = await tx.punch.create({
      data: {
        employeeId: e.id,
        kind: input.body.kind,
        at,
        source: 'manual',
        reason: input.body.reason,
        byUserId: input.actorUserId,
        darkStoreId: e.homeStoreId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'attendance.manual_punch',
      entityType: 'employee',
      entityId: e.id,
      after: {
        punchId: punch.id,
        kind: punch.kind,
        at: at.toISOString(),
        reason: input.body.reason,
      },
    });
    await refreshAround(tx, e.id, at, now);
    return { id: punch.id, kind: punch.kind, at: punch.at };
  });
}

/** A wrong punch is voided with a reason (never deleted). Audited; the day is built again. */
export function voidPunch(
  db: Db,
  input: { punchId: string; reason: string; actorUserId: string; scope: StoreScope; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const punch = await tx.punch.findUnique({
      where: { id: input.punchId },
      include: { employee: { select: { homeStoreId: true } } },
    });
    if (!punch) throw new DomainError('punch_not_found', 404);
    if (!inScope(input.scope, punch.employee.homeStoreId))
      throw new DomainError('store_not_allowed', 403);
    const done = await tx.punch.updateMany({
      where: { id: punch.id, voidedAt: null },
      data: { voidedAt: now, voidedById: input.actorUserId, voidReason: input.reason },
    });
    if (done.count !== 1) throw new DomainError('punch_already_voided');
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'attendance.void_punch',
      entityType: 'employee',
      entityId: punch.employeeId,
      before: { punchId: punch.id, kind: punch.kind, at: punch.at.toISOString() },
      after: { voided: true, reason: input.reason },
    });
    await refreshAround(tx, punch.employeeId, punch.at, now);
    return { voided: true };
  });
}

/**
 * A manager sets a past or today's day's status (null: back to the computed one), with a
 * reason. The day is closed first when it was not yet; later rebuilds keep the status.
 */
export function setDayStatus(
  db: Db,
  input: { body: DayStatusBody; actorUserId: string; scope: StoreScope; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const { employeeId, day, status, reason } = input.body;
    if (day > cairoDay(now)) throw new DomainError('day_in_future', 400);
    const e = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (!inScope(input.scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
    const where = { employeeId_day: { employeeId, day: dayDate(day) } };
    let row = await tx.attendanceDay.findUnique({ where });
    if (!row) {
      // Not closed yet (today, or a day nobody was planned): build it now.
      const ctx = await loadDay(tx, employeeId, day);
      const computed = computeAttendance({
        plan: ctx.plan,
        planned: !!ctx.row,
        holiday: ctx.holiday,
        onLeave: isOnLeave({ employee: e, leave: ctx.leave, sessions: ctx.sessions }),
        sessions: ctx.sessions,
        rules: await rulesOf(tx),
      });
      row = await tx.attendanceDay.create({
        data: {
          employeeId,
          day: dayDate(day),
          darkStoreId: ctx.row?.darkStoreId ?? e.homeStoreId,
          shiftId: ctx.plan?.shiftId ?? null,
          plannedStart: ctx.plan?.start ?? null,
          plannedEnd: ctx.plan?.end ?? null,
          status: computed.status,
          computedStatus: computed.status,
          firstIn: computed.firstIn,
          lastOut: computed.lastOut,
          lateMinutes: computed.lateMinutes,
          earlyMinutes: computed.earlyMinutes,
          overtimeMinutes: computed.overtimeMinutes,
          workedMinutes: computed.workedMinutes,
          flags: computed.flags,
          closedAt: now,
        },
      });
    }
    const flags = new Set(row.flags);
    if (status) flags.add('corrected');
    else flags.delete('corrected');
    const after = await tx.attendanceDay.update({
      where: { id: row.id },
      data: {
        overrideStatus: status,
        status: status ?? row.computedStatus,
        flags: [...flags],
        correctedById: input.actorUserId,
        correctionReason: reason,
        correctedAt: now,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'attendance.day_status',
      entityType: 'employee',
      entityId: employeeId,
      before: { day, status: row.status, overrideStatus: row.overrideStatus },
      after: { day, status: after.status, overrideStatus: status, reason },
    });
    return dayRowView(after);
  });
}

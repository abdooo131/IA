import type { AccessProfile } from '@shiplynow/shared';
import {
  addDays,
  cairoDay,
  type DirectorySort,
  type EmployeeFlag,
  employeeCode,
  employeeFlags,
  fileCompleteness,
  nextYearly,
  probationEnd,
  withinNextDays,
} from '@shiplynow/shared';
import { attendanceBoard } from './attendance';
import type { Db } from './client';
import { DomainError } from './domain-error';
import {
  type EmployeeListFilter,
  type EmployeeListRow,
  listEmployees,
  type StoreScope,
} from './hr';
import { completenessFor, documentChecklist, missingDocuments } from './hr-documents';
import { hrInbox } from './hr-inbox';
import { getSetting } from './settings';

// HR phase 1 (docs/HR.md "Phase 1 as built"): the HR home (what needs attention today), the
// employee list's flags, filters, sort and pages, and a file's completeness. Read only: every
// figure comes from the records HR already keeps, inside the person's store scope.

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const storeWhere = (scope: StoreScope) => (scope === null ? {} : { homeStoreId: { in: scope } });

/** Days ahead the home looks for probation and contract ends. */
const ENDS_WITHIN_DAYS = 30;
/** Days ahead (today included) for birthdays and work anniversaries: this week. */
const WEEK_DAYS = 6;

/** The list flags of the given people (documents, probation, leaving, leave today, violations). */
export async function employeeFlagsFor(
  db: Db,
  rows: Pick<EmployeeListRow, 'id' | 'status' | 'leftOn' | 'probationEndsOn' | 'hireDate'>[],
  now: Date = new Date(),
) {
  const today = cairoDay(now);
  const ids = rows.map((r) => r.id);
  const [docs, months, leave, violations] = await Promise.all([
    completenessFor(db, ids),
    getSetting(db, 'hr.probation_months'),
    db.leaveRequestDay.findMany({
      where: { employeeId: { in: ids }, day: dayDate(today), request: { status: 'approved' } },
      select: { employeeId: true },
    }),
    db.violation.groupBy({
      by: ['employeeId'],
      where: { employeeId: { in: ids }, status: { in: ['recorded', 'appealed'] } },
      _count: { _all: true },
    }),
  ]);
  const onLeave = new Set(leave.map((l) => l.employeeId));
  const open = new Map(violations.map((v) => [v.employeeId, v._count._all]));
  const out = new Map<
    string,
    {
      documents: { percent: number; missing: number };
      probationEndsOn: string | null;
      openViolations: number;
      flags: EmployeeFlag[];
    }
  >();
  for (const r of rows) {
    const documents = docs.get(r.id) ?? { percent: 100, missing: 0 };
    const probation = probationEnd({
      probationEndsOn: r.probationEndsOn,
      hireDate: r.hireDate,
      months,
    });
    const openViolations = open.get(r.id) ?? 0;
    out.set(r.id, {
      documents,
      probationEndsOn: probation,
      openViolations,
      flags: employeeFlags(
        {
          status: r.status,
          leftOn: r.leftOn,
          probationEndsOn: probation,
          missingDocuments: documents.missing,
          onLeaveToday: onLeave.has(r.id),
          openViolations,
        },
        today,
      ),
    });
  }
  return out;
}

export interface DirectoryFilter extends EmployeeListFilter {
  flag?: EmployeeFlag;
  sort?: DirectorySort;
  desc?: boolean;
  /** 1 based; ignored when pageSize is null (the CSV takes every row) */
  page?: number;
  pageSize?: number | null;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * The employee list: the directory's rows with documents, probation and flags, filtered by a
 * flag, sorted and cut into pages. Counts per flag are of the filtered rows before the flag.
 */
export async function employeeDirectory(db: Db, f: DirectoryFilter, now: Date = new Date()) {
  const base = await listEmployees(db, f);
  const extra = await employeeFlagsFor(db, base, now);
  const rows = base.map((r) => ({ ...r, ...extra.get(r.id)! }));
  const flagCounts: Partial<Record<EmployeeFlag, number>> = {};
  for (const r of rows) for (const k of r.flags) flagCounts[k] = (flagCounts[k] ?? 0) + 1;
  const kept = f.flag ? rows.filter((r) => r.flags.includes(f.flag!)) : rows;
  const text = (v: string | null | undefined) => v ?? '';
  const by: Record<DirectorySort, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> =
    {
      name: (a, b) => collator.compare(a.nameEn, b.nameEn),
      code: (a, b) => collator.compare(a.code, b.code),
      hired: (a, b) => text(a.hireDate).localeCompare(text(b.hireDate)),
      department: (a, b) =>
        collator.compare(text(a.department?.nameEn), text(b.department?.nameEn)),
      store: (a, b) => collator.compare(text(a.homeStore?.code), text(b.homeStore?.code)),
      documents: (a, b) => a.documents.percent - b.documents.percent,
    };
  const sort = f.sort ?? 'name';
  kept.sort((a, b) => {
    const c = by[sort](a, b) || collator.compare(a.nameEn, b.nameEn);
    return f.desc ? -c : c;
  });
  const total = kept.length;
  const pageSize = f.pageSize === null ? Math.max(total, 1) : (f.pageSize ?? 50);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  return {
    rows: kept.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pages,
    pageSize,
    flagCounts,
  };
}

/**
 * How complete one file is (HR phase 1): photo, contact and identity fields, the emergency
 * contact, the hire date, the salary bank account (employees, with the salaries switch) and
 * every required document, with exactly what is missing.
 */
export async function employeeFileCompleteness(
  db: Db,
  employeeId: string,
  options: { scope: StoreScope; confidential: boolean; bank: boolean },
) {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { phone: true } }, photo: { select: { updatedAt: true } } },
  });
  if (!e) throw new DomainError('employee_not_found', 404);
  if (options.scope !== null && !(e.homeStoreId && options.scope.includes(e.homeStoreId)))
    throw new DomainError('store_not_allowed', 403);
  const checklist = await documentChecklist(db, employeeId, {
    confidential: options.confidential,
  });
  return fileCompleteness({
    hasPhoto: !!e.photo,
    mobile: e.user.phone,
    nationalId: e.nationalId,
    birthDate: day(e.birthDate),
    address: e.address,
    emergencyName: e.emergencyName,
    emergencyPhone: e.emergencyPhone,
    hireDate: day(e.hireDate),
    ...(options.bank &&
      e.employment === 'employee' &&
      e.payBasis === 'monthly_salary' && {
        bank: { iban: e.iban, bankAccountNumber: e.bankAccountNumber },
      }),
    documents: checklist.items,
  });
}

type Person = { id: string; number: number; nameEn: string; nameAr: string | null };
const person = (p: Person) => ({
  id: p.id,
  code: employeeCode(p.number),
  nameEn: p.nameEn,
  nameAr: p.nameAr,
});

/**
 * The HR home: what needs attention today in the person's stores. Who is in, late, absent and
 * on leave now (the Today board), what waits in their inbox, suggested and open violations,
 * documents not in order, onboarding and offboarding in progress, probation and contract ends
 * in the next 30 days, birthdays and work anniversaries this week, and the headcount by
 * department and employment.
 */
export async function hrOverview(
  db: Db,
  input: {
    scope: StoreScope;
    userId: string;
    access: AccessProfile | null | undefined;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const today = cairoDay(now);
  const scope = input.scope;
  const [board, inbox, docs, months, people, checklists, openViolations, departments] =
    await Promise.all([
      attendanceBoard(db, { scope, now }),
      hrInbox(db, { userId: input.userId, access: input.access }),
      missingDocuments(db, { scope }),
      getSetting(db, 'hr.probation_months'),
      db.employee.findMany({
        where: { status: { not: 'left' }, ...storeWhere(scope) },
        select: {
          id: true,
          number: true,
          nameEn: true,
          nameAr: true,
          status: true,
          employment: true,
          departmentId: true,
          hireDate: true,
          birthDate: true,
          probationEndsOn: true,
          contractEndsOn: true,
          photo: { select: { updatedAt: true } },
        },
        orderBy: { nameEn: 'asc' },
      }),
      db.employeeChecklist.findMany({
        where: { status: 'open', employee: storeWhere(scope) },
        include: {
          employee: { select: { id: true, number: true, nameEn: true, nameAr: true } },
          tasks: { select: { doneAt: true, dueOn: true } },
        },
        orderBy: { startsOn: 'asc' },
      }),
      db.violation.count({
        where: { status: { in: ['recorded', 'appealed'] }, employee: storeWhere(scope) },
      }),
      db.department.findMany({
        select: { id: true, code: true, nameEn: true, nameAr: true, sort: true },
        orderBy: [{ sort: 'asc' }, { nameEn: 'asc' }],
      }),
    ]);

  // Right now, from the Today board.
  const pick = (states: string[]) =>
    board.people
      .filter((p) => states.includes(p.state))
      .map((p) => ({
        employee: p.employee,
        store: p.store,
        state: p.state,
        lateMinutes: p.lateMinutes,
        missingMinutes: p.missingMinutes,
      }));
  const c = (k: string) => board.counts[k] ?? 0;
  const now_ = {
    day: board.day,
    holiday: board.holiday,
    in: c('in') + c('late_in'),
    late: c('late_in'),
    absent: c('missing'),
    onLeave: c('on_leave'),
    notYet: c('not_yet'),
    left: c('left'),
    off: c('day_off') + c('holiday') + c('unplanned'),
    attention: pick(['missing', 'late_in']).slice(0, 8),
    onLeaveList: pick(['on_leave']).slice(0, 8),
  };

  // Documents not in order.
  const docCount = (states: string[]) => docs.filter((d) => states.includes(d.state)).length;
  const documents = {
    missing: docCount(['missing', 'rejected']),
    waiting: docCount(['pending']),
    expiring: docCount(['expiring']),
    expired: docCount(['expired']),
    people: new Set(docs.map((d) => d.employee.id)).size,
    soon: docs
      .filter((d) => d.state === 'expiring' || d.state === 'expired')
      .sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''))
      .slice(0, 6)
      .map((d) => ({
        employee: person(d.employee),
        type: d.type,
        state: d.state,
        expiresOn: d.expiresOn,
      })),
  };

  // Checklists in progress (offboarding of people who left included).
  const lists = checklists.map((l) => ({
    id: l.id,
    kind: l.kind,
    nameEn: l.nameEn,
    nameAr: l.nameAr,
    startsOn: day(l.startsOn),
    employee: person(l.employee),
    done: l.tasks.filter((t) => t.doneAt).length,
    total: l.tasks.length,
    overdue: l.tasks.filter((t) => !t.doneAt && day(t.dueOn)! < today).length,
  }));
  const kindOf = (k: string) => lists.filter((l) => l.kind === k);

  // Probation and contracts ending, birthdays and anniversaries.
  const until = addDays(today, ENDS_WITHIN_DAYS);
  const ending = (pick_: (p: (typeof people)[number]) => string | null) =>
    people
      .map((p) => ({ p, on: pick_(p) }))
      .filter((x) => x.on && x.on >= today && x.on <= until)
      .sort((a, b) => a.on!.localeCompare(b.on!))
      .map((x) => ({ employee: person(x.p), on: x.on! }));
  const probation = ending((p) =>
    probationEnd({ probationEndsOn: day(p.probationEndsOn), hireDate: day(p.hireDate), months }),
  );
  const contracts = ending((p) => day(p.contractEndsOn));
  const yearly = (field: 'birthDate' | 'hireDate', minYears: number) =>
    people
      .flatMap((p) => {
        const d = day(p[field]);
        if (!d) return [];
        const next = nextYearly(d, today);
        if (next.years < minYears || !withinNextDays(next.day, today, WEEK_DAYS)) return [];
        return [
          {
            employee: person(p),
            photoVersion: p.photo ? p.photo.updatedAt.getTime() : null,
            on: next.day,
            years: next.years,
          },
        ];
      })
      .sort((a, b) => a.on.localeCompare(b.on));

  // Headcount (everyone not left in the person's stores).
  const perDepartment = new Map<string | null, number>();
  for (const p of people)
    perDepartment.set(p.departmentId, (perDepartment.get(p.departmentId) ?? 0) + 1);
  const byDepartment = [
    ...departments
      .filter((d) => perDepartment.has(d.id))
      .map((d) => ({ department: d, count: perDepartment.get(d.id)! })),
    ...(perDepartment.has(null) ? [{ department: null, count: perDepartment.get(null)! }] : []),
  ];
  const status = (s: string) => people.filter((p) => p.status === s).length;

  return {
    day: today,
    now: now_,
    inbox: {
      total: inbox.total,
      leave: inbox.manager.leave.length + inbox.hrStep.leave.length,
      corrections: inbox.manager.corrections.length + inbox.hrStep.corrections.length,
      appeals: inbox.appeals.length,
    },
    violations: { suggested: inbox.suggestions, open: openViolations },
    documents,
    checklists: {
      onboarding: kindOf('onboarding').length,
      offboarding: kindOf('offboarding').length,
      overdue: lists.filter((l) => l.overdue > 0).length,
      list: [...lists].sort((a, b) => b.overdue - a.overdue).slice(0, 6),
    },
    probation,
    contracts,
    birthdays: yearly('birthDate', 0),
    anniversaries: yearly('hireDate', 1),
    headcount: {
      total: people.length,
      active: status('active'),
      onLeave: status('on_leave'),
      suspended: status('suspended'),
      byDepartment,
      byEmployment: {
        employee: people.filter((p) => p.employment === 'employee').length,
        outsourced: people.filter((p) => p.employment === 'outsourced').length,
      },
    },
  };
}
export type HrOverview = Awaited<ReturnType<typeof hrOverview>>;

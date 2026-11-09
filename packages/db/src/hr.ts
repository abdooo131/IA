import type { Prisma, Role } from '@prisma/client';
import {
  addDays,
  BANK_FIELDS,
  cairoDay,
  type CreateEmployeeBody,
  EMPLOYEE_ROLES,
  employeeCode,
  type EmployeeFileBody,
  type EmployeeStatus,
  type EmployeeStatusBody,
  isTeamRole,
} from '@shiplynow/shared';
import { assertCanDisable } from './access';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { startChecklist } from './hr-checklists';
import {
  assertNoManagerLoop,
  checkPlacement,
  type ManagerLink,
  managerLinks,
  managerOf,
} from './hr-org';
import { getSetting } from './settings';

// HR (docs/HR.md): employee files, their placement in the organisation (department, position,
// grade, manager), status and one history per person. Documents live in hr-documents, the
// salary package and employment in hr-pay, the structure in hr-org and checklists in
// hr-checklists. Every change is audited on the employee with before and after.

type Tx = Prisma.TransactionClient;

/** Store scope of the person asking: null is every store (docs/ACCESS.md). */
export type StoreScope = string[] | null;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (d: string | null | undefined) =>
  d === undefined ? undefined : d === null ? null : new Date(`${d}T00:00:00Z`);

const hasFile = (role: Role) => (EMPLOYEE_ROLES as readonly string[]).includes(role);
/** Store staff and riders work from their account's store; others from the file's. */
const storeFromUser = (role: Role) => role === 'store_staff' || role === 'rider';

const ref = { select: { id: true, code: true, nameEn: true, nameAr: true } } as const;
const fileInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      darkStoreId: true,
      access: { select: { jobRole: true } },
    },
  },
  homeStore: ref,
  department: ref,
  position: {
    select: {
      id: true,
      code: true,
      titleEn: true,
      titleAr: true,
      minGradeId: true,
      maxGradeId: true,
    },
  },
  grade: {
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      rank: true,
      bandMinPiastres: true,
      bandMaxPiastres: true,
    },
  },
  staffingSupplier: { select: { id: true, name: true } },
  manager: { select: { id: true, number: true, nameEn: true, nameAr: true } },
  photo: { select: { updatedAt: true } },
} as const;

type FileRow = Prisma.EmployeeGetPayload<{ include: typeof fileInclude }>;

/** What an audit row keeps of a file: never the documents themselves. */
function snapshot(e: Prisma.EmployeeGetPayload<object>) {
  return {
    nameEn: e.nameEn,
    nameAr: e.nameAr,
    nationalId: e.nationalId,
    nationalIdExpiresOn: day(e.nationalIdExpiresOn),
    birthDate: day(e.birthDate),
    address: e.address,
    emergencyName: e.emergencyName,
    emergencyPhone: e.emergencyPhone,
    jobTitle: e.jobTitle,
    departmentId: e.departmentId,
    positionId: e.positionId,
    gradeId: e.gradeId,
    managerId: e.managerId,
    homeStoreId: e.homeStoreId,
    hireDate: day(e.hireDate),
    contractType: e.contractType,
    contractEndsOn: day(e.contractEndsOn),
    probationEndsOn: day(e.probationEndsOn),
    socialInsuranceNumber: e.socialInsuranceNumber,
    bankName: e.bankName,
    bankAccountNumber: e.bankAccountNumber,
    iban: e.iban,
    bankAccountHolder: e.bankAccountHolder,
    status: e.status,
    leftOn: day(e.leftOn),
    leftReason: e.leftReason,
  };
}

type Who = { id: string; number: number; nameEn: string; nameAr: string | null };
const who = (m: Who | null | undefined) => (m ? { ...m, code: employeeCode(m.number) } : null);

/** The file as the screens show it; bank details only with the salaries switch. */
function view(
  e: FileRow,
  options: { bank: boolean; manager?: { link: ManagerLink; person: Who | null } },
) {
  return {
    id: e.id,
    number: e.number,
    code: employeeCode(e.number),
    user: {
      id: e.user.id,
      name: e.user.name,
      email: e.user.email,
      role: e.user.role,
      isActive: e.user.isActive,
      jobRole: e.user.access?.jobRole ?? null,
    },
    nameEn: e.nameEn,
    nameAr: e.nameAr,
    nationalId: e.nationalId,
    nationalIdExpiresOn: day(e.nationalIdExpiresOn),
    birthDate: day(e.birthDate),
    address: e.address,
    mobile: e.user.phone,
    emergencyName: e.emergencyName,
    emergencyPhone: e.emergencyPhone,
    jobTitle: e.jobTitle,
    department: e.department,
    position: e.position,
    grade: e.grade,
    /** Chosen on the file (may be empty) */
    manager: who(e.manager),
    /** The manager in force: chosen, or the head of the department chain */
    effectiveManager: options.manager ? who(options.manager.person) : who(e.manager),
    managerSource: options.manager ? options.manager.link.source : e.managerId ? 'set' : null,
    homeStore: e.homeStore,
    storeFromAccount: storeFromUser(e.user.role),
    hireDate: day(e.hireDate),
    contractType: e.contractType,
    contractEndsOn: day(e.contractEndsOn),
    probationEndsOn: day(e.probationEndsOn),
    employment: e.employment,
    payBasis: e.payBasis,
    staffingSupplier: e.staffingSupplier,
    socialInsuranceNumber: e.socialInsuranceNumber,
    bank: options.bank
      ? {
          bankName: e.bankName,
          bankAccountNumber: e.bankAccountNumber,
          iban: e.iban,
          bankAccountHolder: e.bankAccountHolder,
        }
      : null,
    photoVersion: e.photo ? e.photo.updatedAt.getTime() : null,
    status: e.status,
    leftOn: day(e.leftOn),
    leftReason: e.leftReason,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
export type EmployeeFile = ReturnType<typeof view>;

/** The department a new file starts in, from the kind of account (HR can change it). */
async function defaultDepartment(tx: Tx, role: Role, storeId: string | null) {
  const store = storeId ? await tx.darkStore.findUnique({ where: { id: storeId } }) : null;
  const code =
    role === 'rider'
      ? 'OPS-RID'
      : role === 'store_staff'
        ? store?.kind === 'hub'
          ? 'OPS-HUB'
          : 'OPS-DS'
        : role === 'finance'
          ? 'FIN'
          : null;
  if (!code) return null;
  return (await tx.department.findUnique({ where: { code } }))?.id ?? null;
}

/**
 * Opens the file of a team member or rider who has none yet, from what the account holds.
 * Used when an account is created, by the seed and when a salary is set. Returns the file.
 */
export async function ensureEmployee(tx: Tx, userId: string) {
  const existing = await tx.employee.findUnique({ where: { userId } });
  if (existing) return existing;
  const user = await tx.user.findUnique({ where: { id: userId }, include: { rider: true } });
  if (!user || !hasFile(user.role)) return null;
  const homeStoreId = storeFromUser(user.role)
    ? (user.darkStoreId ?? user.rider?.darkStoreId ?? null)
    : null;
  return tx.employee.create({
    data: {
      userId: user.id,
      nameEn: user.name,
      homeStoreId,
      departmentId: await defaultDepartment(tx, user.role, homeStoreId),
      contractType: 'permanent',
      // Riders are paid per delivered order (CLAUDE.md "Rider pay"), never a monthly salary.
      payBasis: user.role === 'rider' ? 'per_delivery' : 'monthly_salary',
      hireDate: toDate(cairoDay(user.createdAt)),
      status: user.isActive ? 'active' : 'suspended',
    },
  });
}

/**
 * A new person joined (a new account in Users, or HR opening a file): their file and, when a
 * template exists, their onboarding checklist.
 */
export async function onboardNewPerson(tx: Tx, userId: string, actorUserId: string) {
  const file = await ensureEmployee(tx, userId);
  if (!file) return null;
  const open = await tx.employeeChecklist.count({
    where: { employeeId: file.id, kind: 'onboarding' },
  });
  if (open === 0)
    await startChecklist(tx, {
      employeeId: file.id,
      body: { kind: 'onboarding' },
      actorUserId,
    });
  return file;
}

/** Opens a file for every team member and rider without one (seed and demo). */
export async function ensureEmployees(db: Db) {
  const users = await db.user.findMany({
    where: { role: { in: [...EMPLOYEE_ROLES] }, employee: null },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  for (const u of users) await inTransaction(db, (tx) => ensureEmployee(tx, u.id));
  return users.length;
}

/** Keeps the file's store with the account's for store staff and riders (updateUser). */
export async function syncEmployeeStore(tx: Tx, userId: string, darkStoreId: string | null) {
  await tx.employee.updateMany({ where: { userId }, data: { homeStoreId: darkStoreId } });
}

function inScope(scope: StoreScope, homeStoreId: string | null) {
  return scope === null || (homeStoreId !== null && scope.includes(homeStoreId));
}

async function loadFile(db: Db, id: string, scope: StoreScope) {
  const e = await db.employee.findUnique({ where: { id }, include: fileInclude });
  if (!e) throw new DomainError('employee_not_found', 404);
  if (!inScope(scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
  return e;
}

/** Refuses a file outside the person's stores (or one that does not exist). */
export async function assertFileInScope(db: Db, id: string, scope: StoreScope) {
  const e = await db.employee.findUnique({
    where: { id },
    select: { id: true, homeStoreId: true, userId: true },
  });
  if (!e) throw new DomainError('employee_not_found', 404);
  if (!inScope(scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
  return e;
}

export interface EmployeeListFilter {
  scope: StoreScope;
  q?: string;
  storeId?: string;
  /** The department or any department below it */
  departmentId?: string;
  positionId?: string;
  gradeId?: string;
  employment?: 'employee' | 'outsourced';
  status?: EmployeeStatus;
}

/** A department and every department below it. */
async function departmentAndBelow(db: Db, id: string) {
  const rows = await db.department.findMany({ select: { id: true, parentId: true } });
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of rows)
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
  }
  return [...out];
}

export async function listEmployees(db: Db, f: EmployeeListFilter) {
  const storeIn =
    f.scope === null
      ? undefined
      : { in: f.storeId ? f.scope.filter((s) => s === f.storeId) : f.scope };
  const q = f.q?.trim();
  const digits = q?.replace(/\D/g, '') ?? '';
  // 01012345678 is kept as +201012345678.
  const phone = digits.length >= 4 ? (digits.startsWith('0') ? digits.slice(1) : digits) : null;
  const rows = await db.employee.findMany({
    where: {
      homeStoreId: storeIn ?? (f.storeId || undefined),
      departmentId: f.departmentId
        ? { in: await departmentAndBelow(db, f.departmentId) }
        : undefined,
      positionId: f.positionId || undefined,
      gradeId: f.gradeId || undefined,
      employment: f.employment,
      status: f.status,
      ...(q && {
        OR: [
          { nameEn: { contains: q, mode: 'insensitive' } },
          { nameAr: { contains: q } },
          { jobTitle: { contains: q, mode: 'insensitive' } },
          { nationalId: { contains: q } },
          { user: { name: { contains: q, mode: 'insensitive' } } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
          ...(phone ? [{ user: { phone: { contains: phone } } }] : []),
          ...(/^EMP-?\d+$/i.test(q) ? [{ number: Number(q.replace(/\D/g, '')) }] : []),
        ],
      }),
    },
    include: fileInclude,
    orderBy: [{ status: 'asc' }, { nameEn: 'asc' }],
    take: 1000,
  });
  // The manager in force (set, or the department head chain), as the org chart draws it.
  const [everyone, departments] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: 'left' } },
      select: {
        id: true,
        number: true,
        nameEn: true,
        nameAr: true,
        managerId: true,
        departmentId: true,
      },
    }),
    db.department.findMany({ select: { id: true, parentId: true, headEmployeeId: true } }),
  ]);
  const links = managerLinks(everyone, departments);
  const byId = new Map(everyone.map((p) => [p.id, p]));
  return rows.map((e) => ({
    id: e.id,
    code: employeeCode(e.number),
    nameEn: e.nameEn,
    nameAr: e.nameAr,
    user: { id: e.user.id, role: e.user.role, isActive: e.user.isActive, email: e.user.email },
    mobile: e.user.phone,
    nationalId: e.nationalId,
    jobTitle: e.jobTitle,
    department: e.department,
    position: e.position
      ? { id: e.position.id, titleEn: e.position.titleEn, titleAr: e.position.titleAr }
      : null,
    grade: e.grade
      ? {
          id: e.grade.id,
          code: e.grade.code,
          nameEn: e.grade.nameEn,
          nameAr: e.grade.nameAr,
          rank: e.grade.rank,
        }
      : null,
    manager: who(byId.get(links.get(e.id)?.managerId ?? '') ?? e.manager),
    homeStore: e.homeStore,
    employment: e.employment,
    payBasis: e.payBasis,
    contractType: e.contractType,
    status: e.status,
    hireDate: day(e.hireDate),
    // HR phase 1: the list's flags and the HR home read these.
    leftOn: day(e.leftOn),
    probationEndsOn: day(e.probationEndsOn),
    contractEndsOn: day(e.contractEndsOn),
    photoVersion: e.photo ? e.photo.updatedAt.getTime() : null,
  }));
}
export type EmployeeListRow = Awaited<ReturnType<typeof listEmployees>>[number];

/** Team members and riders who have an account but no file yet (HR links them). */
export async function listPeopleWithoutFile(db: Db) {
  const users = await db.user.findMany({
    where: { role: { in: [...EMPLOYEE_ROLES] }, employee: null },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
  return users;
}

async function withManager(db: Db, e: FileRow, bank: boolean) {
  const link = await managerOf(db, e.id);
  const person =
    link.managerId && link.managerId !== e.managerId
      ? await db.employee.findUnique({
          where: { id: link.managerId },
          select: { id: true, number: true, nameEn: true, nameAr: true },
        })
      : (e.manager ?? null);
  return view(e, { bank, manager: { link, person: link.managerId ? person : null } });
}

export async function getEmployee(
  db: Db,
  id: string,
  options: { scope: StoreScope; bank: boolean },
) {
  return withManager(db, await loadFile(db, id, options.scope), options.bank);
}

/** The person's own file, read only. Null for merchants and people without one. */
export async function getOwnEmployee(db: Db, userId: string) {
  const e = await db.employee.findUnique({ where: { userId }, include: fileInclude });
  if (!e) return null;
  // Their own bank details are theirs to see.
  return withManager(db, e, true);
}

async function checkRefs(
  tx: Tx,
  employeeId: string | null,
  body: Pick<EmployeeFileBody, 'managerId' | 'homeStoreId'>,
) {
  if (body.managerId) {
    if (body.managerId === employeeId) throw new DomainError('manager_is_self', 400);
    const m = await tx.employee.findUnique({ where: { id: body.managerId } });
    if (!m) throw new DomainError('manager_not_found', 404);
  }
  if (body.homeStoreId) {
    const s = await tx.darkStore.findUnique({ where: { id: body.homeStoreId } });
    if (!s) throw new DomainError('dark_store_not_found', 404);
  }
}

/** Turns a body into column values; undefined leaves a field as it is. */
function fileData(body: EmployeeFileBody, options: { bank: boolean; storeFromUser: boolean }) {
  if (!options.bank && BANK_FIELDS.some((k) => body[k] !== undefined))
    throw new DomainError('salaries_required', 403);
  if (options.storeFromUser && body.homeStoreId !== undefined)
    throw new DomainError('store_set_on_account', 400);
  return {
    nameEn: body.nameEn,
    nameAr: body.nameAr,
    nationalId: body.nationalId,
    nationalIdExpiresOn: toDate(body.nationalIdExpiresOn),
    birthDate: toDate(body.birthDate),
    address: body.address,
    emergencyName: body.emergencyName,
    emergencyPhone: body.emergencyPhone,
    jobTitle: body.jobTitle,
    departmentId: body.departmentId,
    positionId: body.positionId,
    gradeId: body.gradeId,
    managerId: body.managerId,
    homeStoreId: body.homeStoreId,
    hireDate: toDate(body.hireDate),
    contractType: body.contractType,
    contractEndsOn: toDate(body.contractEndsOn),
    probationEndsOn: toDate(body.probationEndsOn),
    socialInsuranceNumber: body.socialInsuranceNumber,
    bankName: body.bankName,
    bankAccountNumber: body.bankAccountNumber,
    iban: body.iban,
    bankAccountHolder: body.bankAccountHolder,
  };
}

function checkDates(e: {
  hireDate: Date | null;
  contractEndsOn: Date | null;
  probationEndsOn: Date | null;
  contractType: string;
}) {
  if (e.hireDate && e.contractEndsOn && e.contractEndsOn < e.hireDate)
    throw new DomainError('contract_ends_before_hire', 400);
  if (e.hireDate && e.probationEndsOn && e.probationEndsOn < e.hireDate)
    throw new DomainError('probation_ends_before_hire', 400);
  if (e.contractType === 'fixed_term' && !e.contractEndsOn)
    throw new DomainError('contract_end_required', 400);
}

/** The probation end filled in from the hire date (hr.probation_months), when none is given. */
async function probationFrom(db: Db, hireDate: string | null | undefined) {
  if (!hireDate) return undefined;
  const months = await getSetting(db, 'hr.probation_months');
  if (months === 0) return undefined;
  const d = new Date(`${hireDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return addDays(d.toISOString().slice(0, 10), -1);
}

/**
 * Checks department, position and grade together after a change and fills the department
 * from the position when the file has none.
 */
async function placeAfter(tx: Tx, e: Prisma.EmployeeGetPayload<object>) {
  const { position } = await checkPlacement(tx, e);
  if (position && !e.departmentId)
    return tx.employee.update({
      where: { id: e.id },
      data: { departmentId: position.departmentId },
    });
  return e;
}

/** Opens a file for an account that has none (HR manage); the onboarding checklist starts. */
export function createEmployee(
  db: Db,
  input: { body: CreateEmployeeBody; actorUserId: string; bank: boolean; scope: StoreScope },
) {
  return inTransaction(db, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.body.userId } });
    if (!user) throw new DomainError('user_not_found', 404);
    if (!hasFile(user.role)) throw new DomainError('not_team_member', 400);
    if (await tx.employee.findUnique({ where: { userId: user.id } }))
      throw new DomainError('employee_exists', 409);
    const { userId: _u, mobile, ...rest } = input.body;
    await checkRefs(tx, null, rest);
    const created = await ensureEmployee(tx, user.id);
    if (!inScope(input.scope, created!.homeStoreId ?? rest.homeStoreId ?? null))
      throw new DomainError('store_not_allowed', 403);
    const probationEndsOn =
      rest.probationEndsOn === undefined
        ? await probationFrom(tx, rest.hireDate)
        : rest.probationEndsOn;
    const data = fileData(
      { ...rest, probationEndsOn },
      { bank: input.bank, storeFromUser: storeFromUser(user.role) },
    );
    let e = await tx.employee.update({ where: { id: created!.id }, data });
    e = await placeAfter(tx, e);
    checkDates(e);
    await assertNoManagerLoop(tx);
    if (mobile !== undefined) await setMobile(tx, user.id, mobile);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.create',
      entityType: 'employee',
      entityId: e.id,
      after: snapshot(e),
    });
    await onboardNewPerson(tx, user.id, input.actorUserId);
    return withManager(tx, await loadFile(tx, e.id, null), input.bank);
  });
}

async function setMobile(tx: Tx, userId: string, phone: string | null) {
  const taken = phone
    ? await tx.user.findFirst({ where: { phone, id: { not: userId } }, select: { id: true } })
    : null;
  if (taken) throw new DomainError('phone_taken', 409);
  await tx.user.update({ where: { id: userId }, data: { phone } });
}

export function updateEmployee(
  db: Db,
  input: {
    employeeId: string;
    body: EmployeeFileBody;
    actorUserId: string;
    bank: boolean;
    scope: StoreScope;
  },
) {
  return inTransaction(db, async (tx) => {
    const before = await loadFile(tx, input.employeeId, input.scope);
    const { mobile, ...rest } = input.body;
    await checkRefs(tx, before.id, rest);
    if (rest.homeStoreId && !inScope(input.scope, rest.homeStoreId))
      throw new DomainError('store_not_allowed', 403);
    const data = fileData(rest, {
      bank: input.bank,
      storeFromUser: storeFromUser(before.user.role),
    });
    if (before.employment === 'outsourced' && data.contractType)
      throw new DomainError('contract_follows_employment', 400);
    let after = await tx.employee.update({ where: { id: before.id }, data });
    after = await placeAfter(tx, after);
    checkDates(after);
    await assertNoManagerLoop(tx);
    const phoneBefore = before.user.phone;
    if (mobile !== undefined && mobile !== phoneBefore) await setMobile(tx, before.userId, mobile);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.update',
      entityType: 'employee',
      entityId: before.id,
      before: { ...snapshot(before), mobile: phoneBefore },
      after: { ...snapshot(after), mobile: mobile === undefined ? phoneBefore : mobile },
    });
    return withManager(tx, await loadFile(tx, before.id, null), input.bank);
  });
}

/**
 * Active, on leave, suspended or left (with the last day and the reason). Leaving also
 * disables the account, signs the person out everywhere and starts the offboarding checklist;
 * coming back does not reopen the account (the Users screen does).
 */
export function setEmployeeStatus(
  db: Db,
  input: { employeeId: string; body: EmployeeStatusBody; actorUserId: string; scope: StoreScope },
) {
  return inTransaction(db, async (tx) => {
    const before = await loadFile(tx, input.employeeId, input.scope);
    const { status, leftOn, reason } = input.body;
    if (status === before.status && status !== 'left')
      throw new DomainError('status_unchanged', 409);
    if (status === 'left') {
      if (before.userId === input.actorUserId) throw new DomainError('cannot_leave_self', 400);
      if (before.hireDate && toDate(leftOn)! < before.hireDate)
        throw new DomainError('left_before_hire', 400);
    }
    const after = await tx.employee.update({
      where: { id: before.id },
      data: {
        status,
        leftOn: status === 'left' ? toDate(leftOn) : null,
        leftReason: status === 'left' ? reason : null,
      },
    });
    let disabled = false;
    if (status === 'left' && before.user.isActive) {
      if (isTeamRole(before.user.role)) await assertCanDisable(tx, before.userId);
      await tx.user.update({ where: { id: before.userId }, data: { isActive: false } });
      await tx.refreshToken.updateMany({
        where: { userId: before.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      disabled = true;
    }
    // A person who leaves stops heading departments (their people move up the chain).
    if (status === 'left')
      await tx.department.updateMany({
        where: { headEmployeeId: before.id },
        data: { headEmployeeId: null },
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.status',
      entityType: 'employee',
      entityId: before.id,
      before: { status: before.status, leftOn: day(before.leftOn), leftReason: before.leftReason },
      after: {
        status: after.status,
        leftOn: day(after.leftOn),
        leftReason: after.leftReason,
        ...(reason && status !== 'left' && { reason }),
        ...(disabled && { accountDisabled: true }),
      },
    });
    if (status === 'left' && before.status !== 'left') {
      const open = await tx.employeeChecklist.count({
        where: { employeeId: before.id, kind: 'offboarding', status: 'open' },
      });
      if (open === 0)
        await startChecklist(tx, {
          employeeId: before.id,
          body: { kind: 'offboarding', startsOn: leftOn },
          actorUserId: input.actorUserId,
        });
    }
    return view(await loadFile(tx, before.id, null), { bank: false });
  });
}

// ─── history ───────────────────────────────────────────────────────────────────

/** Actions that carry pay: shown only with the salaries switch. */
const PAY_ACTIONS = ['finance.salary_set', 'employee.package'];

/**
 * One timeline per person, newest first: the file (created, changed, status, documents), the
 * account (created, changed, access) and pay changes (with the salaries switch). Bank details
 * are left out of the rows unless `pay` is true.
 */
export async function employeeHistory(
  db: Db,
  input: { employeeId: string; scope: StoreScope; pay: boolean },
) {
  const e = await loadFile(db, input.employeeId, input.scope);
  // HR phase 3: the person's leave requests, violations and attendance fixes are in the timeline.
  const [leave, violations, corrections] = await Promise.all([
    db.leaveRequest.findMany({ where: { employeeId: e.id }, select: { id: true } }),
    db.violation.findMany({ where: { employeeId: e.id }, select: { id: true } }),
    db.attendanceCorrection.findMany({ where: { employeeId: e.id }, select: { id: true } }),
  ]);
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const rows = await db.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'employee', entityId: e.id },
        { entityType: 'user', entityId: e.userId },
        { entityType: 'leave_request', entityId: { in: ids(leave) } },
        { entityType: 'violation', entityId: { in: ids(violations) } },
        { entityType: 'attendance_correction', entityId: { in: ids(corrections) } },
      ],
      ...(input.pay ? {} : { action: { notIn: PAY_ACTIONS } }),
    },
    include: { actor: { select: { name: true, role: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 300,
  });
  const strip = (v: Prisma.JsonValue | null) => {
    if (input.pay || !v || typeof v !== 'object' || Array.isArray(v)) return v;
    const copy = { ...(v as Record<string, unknown>) };
    for (const k of BANK_FIELDS) delete copy[k];
    // Older account rows never hold passwords, but be safe about anything named so.
    delete copy.passwordHash;
    return copy as Prisma.JsonValue;
  };
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    action: r.action,
    actor: r.actor ? { name: r.actor.name, role: r.actor.role } : null,
    before: strip(r.before) as unknown,
    after: strip(r.after) as unknown,
  }));
}

// ─── account managers ──────────────────────────────────────────────────────────

/** Gives a merchant its account manager (an active team member), or none. Audited. */
export function setAccountManager(
  db: Db,
  input: { merchantId: string; userId: string | null; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    if (input.userId) {
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user || !isTeamRole(user.role)) throw new DomainError('user_not_found', 404);
      if (!user.isActive) throw new DomainError('user_inactive', 409);
    }
    if (merchant.accountManagerId === input.userId) return { accountManagerId: input.userId };
    await tx.merchant.update({
      where: { id: merchant.id },
      data: { accountManagerId: input.userId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.account_manager',
      entityType: 'merchant',
      entityId: merchant.id,
      before: { accountManagerId: merchant.accountManagerId },
      after: { accountManagerId: input.userId },
    });
    return { accountManagerId: input.userId };
  });
}

/** Team members who may be picked as an account manager: active, with merchants access. */
export async function listAccountManagers(db: Db) {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['admin', 'finance', 'store_staff'] },
      access: { merchants: { not: 'none' } },
    },
    select: { id: true, name: true, email: true, access: { select: { jobRole: true } } },
    orderBy: { name: 'asc' },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    jobRole: u.access?.jobRole ?? null,
  }));
}

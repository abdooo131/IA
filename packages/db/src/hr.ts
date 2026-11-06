import type { Prisma, Role } from '@prisma/client';
import {
  addDays,
  BANK_FIELDS,
  cairoDay,
  type CreateEmployeeBody,
  DOCUMENT_TYPES,
  type DocumentKind,
  EMPLOYEE_ROLES,
  employeeCode,
  type EmployeeFileBody,
  type EmployeeStatus,
  type EmployeeStatusBody,
  isTeamRole,
  MAX_DOCUMENT_BYTES,
} from '@shiplynow/shared';
import { assertCanDisable } from './access';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { getSetting } from './settings';

// HR step 1 (docs/HR.md): employee files, their documents, the expiry alerts and one history
// per person. Every change is audited on the employee with before and after.

type Tx = Prisma.TransactionClient;

/** Store scope of the person asking: null is every store (docs/ACCESS.md). */
export type StoreScope = string[] | null;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (d: string | null | undefined) =>
  d === undefined ? undefined : d === null ? null : new Date(`${d}T00:00:00Z`);

const hasFile = (role: Role) => (EMPLOYEE_ROLES as readonly string[]).includes(role);
/** Store staff and riders work from their account's store; others from the file's. */
const storeFromUser = (role: Role) => role === 'store_staff' || role === 'rider';

const fileInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      employment: true,
      darkStoreId: true,
      staffingSupplier: { select: { id: true, name: true } },
      access: { select: { jobRole: true } },
    },
  },
  homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  manager: { select: { id: true, number: true, nameEn: true, nameAr: true } },
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
    department: e.department,
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

/** The file as the screens show it; bank details only with the salaries switch. */
function view(e: FileRow, options: { bank: boolean }) {
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
    manager: e.manager
      ? { ...e.manager, code: employeeCode(e.manager.number) }
      : (null as null | { id: string; number: number; nameEn: string; nameAr: string | null }),
    homeStore: e.homeStore,
    storeFromAccount: storeFromUser(e.user.role),
    hireDate: day(e.hireDate),
    contractType: e.contractType,
    contractEndsOn: day(e.contractEndsOn),
    probationEndsOn: day(e.probationEndsOn),
    employment: e.user.employment,
    staffingSupplier: e.user.staffingSupplier,
    socialInsuranceNumber: e.socialInsuranceNumber,
    bank: options.bank
      ? {
          bankName: e.bankName,
          bankAccountNumber: e.bankAccountNumber,
          iban: e.iban,
          bankAccountHolder: e.bankAccountHolder,
        }
      : null,
    status: e.status,
    leftOn: day(e.leftOn),
    leftReason: e.leftReason,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
export type EmployeeFile = ReturnType<typeof view>;

/**
 * Opens the file of a team member or rider who has none yet, from what the account holds.
 * Used when an account is created, by the seed and when a salary is set. Returns the file.
 */
export async function ensureEmployee(tx: Tx, userId: string) {
  const existing = await tx.employee.findUnique({ where: { userId } });
  if (existing) return existing;
  const user = await tx.user.findUnique({ where: { id: userId }, include: { rider: true } });
  if (!user || !hasFile(user.role)) return null;
  return tx.employee.create({
    data: {
      userId: user.id,
      nameEn: user.name,
      homeStoreId: storeFromUser(user.role)
        ? (user.darkStoreId ?? user.rider?.darkStoreId ?? null)
        : null,
      contractType: user.employment === 'outsourced' ? 'outsourced' : 'permanent',
      hireDate: toDate(cairoDay(user.createdAt)),
      status: user.isActive ? 'active' : 'suspended',
    },
  });
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

/** Payroll changed a person's employment: the contract type follows. */
export async function syncEmployment(tx: Tx, userId: string, outsourced: boolean) {
  const e = await tx.employee.findUnique({ where: { userId } });
  if (!e) return;
  if (outsourced && e.contractType !== 'outsourced')
    await tx.employee.update({ where: { id: e.id }, data: { contractType: 'outsourced' } });
  if (!outsourced && e.contractType === 'outsourced')
    await tx.employee.update({ where: { id: e.id }, data: { contractType: 'permanent' } });
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

export interface EmployeeListFilter {
  scope: StoreScope;
  q?: string;
  storeId?: string;
  department?: string;
  status?: EmployeeStatus;
}

export async function listEmployees(db: Db, f: EmployeeListFilter) {
  const storeIn =
    f.scope === null
      ? undefined
      : { in: f.storeId ? f.scope.filter((s) => s === f.storeId) : f.scope };
  const rows = await db.employee.findMany({
    where: {
      homeStoreId: storeIn ?? (f.storeId || undefined),
      department: f.department || undefined,
      status: f.status,
      ...(f.q && {
        OR: [
          { nameEn: { contains: f.q, mode: 'insensitive' } },
          { nameAr: { contains: f.q } },
          { jobTitle: { contains: f.q, mode: 'insensitive' } },
          { nationalId: { contains: f.q } },
          { user: { name: { contains: f.q, mode: 'insensitive' } } },
          { user: { email: { contains: f.q, mode: 'insensitive' } } },
          { user: { phone: { contains: f.q } } },
        ],
      }),
    },
    include: { ...fileInclude, documents: { select: { expiresOn: true } } },
    orderBy: [{ status: 'asc' }, { nameEn: 'asc' }],
    take: 500,
  });
  const today = cairoDay(new Date());
  return rows.map((e) => ({
    id: e.id,
    code: employeeCode(e.number),
    nameEn: e.nameEn,
    nameAr: e.nameAr,
    user: { id: e.user.id, role: e.user.role, isActive: e.user.isActive, email: e.user.email },
    mobile: e.user.phone,
    jobTitle: e.jobTitle,
    department: e.department,
    homeStore: e.homeStore,
    contractType: e.contractType,
    status: e.status,
    hireDate: day(e.hireDate),
    documents: e.documents.length,
    expiredDocuments: e.documents.filter((d) => d.expiresOn && day(d.expiresOn)! < today).length,
  }));
}

/** Team members and riders who have an account but no file yet (HR links them). */
export async function listPeopleWithoutFile(db: Db) {
  const users = await db.user.findMany({
    where: { role: { in: [...EMPLOYEE_ROLES] }, employee: null },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
  return users;
}

export async function getEmployee(
  db: Db,
  id: string,
  options: { scope: StoreScope; bank: boolean },
) {
  return view(await loadFile(db, id, options.scope), { bank: options.bank });
}

/** The person's own file, read only. Null for merchants and people without one. */
export async function getOwnEmployee(db: Db, userId: string) {
  const e = await db.employee.findUnique({ where: { userId }, include: fileInclude });
  if (!e) return null;
  // Their own bank details are theirs to see.
  return view(e, { bank: true });
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
    // A manager chain never loops back to this person.
    let cursor = m.managerId;
    for (let i = 0; cursor && i < 50; i++) {
      if (cursor === employeeId) throw new DomainError('manager_loop', 400);
      cursor = (await tx.employee.findUnique({ where: { id: cursor } }))?.managerId ?? null;
    }
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
    department: body.department,
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

/** Opens a file for an account that has none (HR manage). */
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
    const e = await tx.employee.update({
      where: { id: created!.id },
      data: {
        ...data,
        contractType: user.employment === 'outsourced' ? 'outsourced' : data.contractType,
      },
    });
    checkDates(e);
    if (mobile !== undefined) await setMobile(tx, user.id, mobile);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.create',
      entityType: 'employee',
      entityId: e.id,
      after: snapshot(e),
    });
    return view(await loadFile(tx, e.id, null), { bank: input.bank });
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
    if (before.user.employment === 'outsourced' && data.contractType)
      throw new DomainError('employment_set_in_payroll', 400);
    const after = await tx.employee.update({ where: { id: before.id }, data });
    checkDates(after);
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
    return view(await loadFile(tx, before.id, null), { bank: input.bank });
  });
}

/**
 * Active, on leave, suspended or left (with the last day and the reason). Leaving also
 * disables the account and signs the person out everywhere; coming back does not reopen it
 * (the Users screen does).
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
    return view(await loadFile(tx, before.id, null), { bank: false });
  });
}

// ─── documents ─────────────────────────────────────────────────────────────────

const docSelect = {
  id: true,
  kind: true,
  title: true,
  contentType: true,
  sizeBytes: true,
  issuedOn: true,
  expiresOn: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

function docView(d: Prisma.EmployeeDocumentGetPayload<{ select: typeof docSelect }>) {
  return { ...d, issuedOn: day(d.issuedOn), expiresOn: day(d.expiresOn) };
}

/** The first bytes every file of each allowed type starts with. */
function looksLike(contentType: string, data: Buffer) {
  const starts = (bytes: number[], at = 0) => bytes.every((b, i) => data[at + i] === b);
  if (contentType === 'image/jpeg') return starts([0xff, 0xd8, 0xff]);
  if (contentType === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === 'image/webp')
    return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
  if (contentType === 'application/pdf') return starts([0x25, 0x50, 0x44, 0x46]); // %PDF
  return false;
}

export async function addEmployeeDocument(
  db: Db,
  input: {
    employeeId: string;
    kind: DocumentKind;
    title?: string;
    issuedOn?: string;
    expiresOn?: string;
    contentType: string;
    data: Buffer;
    actorUserId: string;
    scope: StoreScope;
  },
) {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(input.contentType))
    throw new DomainError('document_type_not_allowed', 400);
  if (input.data.length === 0) throw new DomainError('document_empty', 400);
  if (input.data.length > MAX_DOCUMENT_BYTES) throw new DomainError('document_too_large', 400);
  if (!looksLike(input.contentType, input.data))
    throw new DomainError('document_not_readable', 400);
  if (input.issuedOn && input.expiresOn && input.expiresOn < input.issuedOn)
    throw new DomainError('expires_before_issued', 400);
  return inTransaction(db, async (tx) => {
    const e = await loadFile(tx, input.employeeId, input.scope);
    const doc = await tx.employeeDocument.create({
      data: {
        employeeId: e.id,
        kind: input.kind,
        title: input.title || null,
        contentType: input.contentType,
        data: new Uint8Array(input.data),
        sizeBytes: input.data.length,
        issuedOn: toDate(input.issuedOn ?? null),
        expiresOn: toDate(input.expiresOn ?? null),
        uploadedById: input.actorUserId,
      },
      select: docSelect,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.document_add',
      entityType: 'employee',
      entityId: e.id,
      after: {
        documentId: doc.id,
        kind: doc.kind,
        title: doc.title,
        issuedOn: day(doc.issuedOn),
        expiresOn: day(doc.expiresOn),
        sizeBytes: doc.sizeBytes,
      },
    });
    return docView(doc);
  });
}

export async function listEmployeeDocuments(db: Db, employeeId: string, scope: StoreScope) {
  await loadFile(db, employeeId, scope);
  const docs = await db.employeeDocument.findMany({
    where: { employeeId },
    select: docSelect,
    orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
  });
  return docs.map(docView);
}

/** One document with its bytes, for download. */
export async function getEmployeeDocument(
  db: Db,
  input: { employeeId: string; documentId: string; scope: StoreScope },
) {
  await loadFile(db, input.employeeId, input.scope);
  const doc = await db.employeeDocument.findFirst({
    where: { id: input.documentId, employeeId: input.employeeId },
  });
  if (!doc) throw new DomainError('document_not_found', 404);
  return doc;
}

export function deleteEmployeeDocument(
  db: Db,
  input: { employeeId: string; documentId: string; actorUserId: string; scope: StoreScope },
) {
  return inTransaction(db, async (tx) => {
    const e = await loadFile(tx, input.employeeId, input.scope);
    const doc = await tx.employeeDocument.findFirst({
      where: { id: input.documentId, employeeId: e.id },
      select: docSelect,
    });
    if (!doc) throw new DomainError('document_not_found', 404);
    await tx.employeeDocument.delete({ where: { id: doc.id } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.document_delete',
      entityType: 'employee',
      entityId: e.id,
      before: {
        documentId: doc.id,
        kind: doc.kind,
        title: doc.title,
        issuedOn: day(doc.issuedOn),
        expiresOn: day(doc.expiresOn),
      },
    });
    return { deleted: true };
  });
}

/**
 * Raises one document_expiring alert per document hr.document_alert_days before it runs out
 * and one document_expired on the day (or the first run after it), also for the national ID
 * date on the file. Each alert has its own key (kind, document and expiry day), so running
 * twice raises nothing twice and a renewed document with a new date is watched again.
 */
export async function checkDocumentExpiry(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const days = await getSetting(db, 'hr.document_alert_days');
  const horizon = toDate(addDays(today, days))!;
  const docs = await db.employeeDocument.findMany({
    where: { expiresOn: { lte: horizon }, employee: { status: { not: 'left' } } },
    select: {
      id: true,
      kind: true,
      title: true,
      expiresOn: true,
      employee: { select: { id: true, nameEn: true, nameAr: true, homeStoreId: true } },
    },
  });
  const ids = await db.employee.findMany({
    where: { nationalIdExpiresOn: { lte: horizon }, status: { not: 'left' } },
    select: { id: true, nameEn: true, nameAr: true, homeStoreId: true, nationalIdExpiresOn: true },
  });
  const items = [
    ...docs.map((d) => ({
      ref: d.id,
      documentId: d.id as string | null,
      kind: d.kind as string,
      title: d.title,
      expiresOn: day(d.expiresOn)!,
      employee: d.employee,
    })),
    ...ids.map((e) => ({
      ref: `nid:${e.id}`,
      documentId: null,
      kind: 'national_id',
      title: null,
      expiresOn: day(e.nationalIdExpiresOn)!,
      employee: e,
    })),
  ];
  const rows = items.map((i) => {
    const type = i.expiresOn <= today ? 'document_expired' : 'document_expiring';
    return {
      type,
      key: `${type}:${i.ref}:${i.expiresOn}`,
      darkStoreId: i.employee.homeStoreId,
      data: {
        employeeId: i.employee.id,
        documentId: i.documentId,
        kind: i.kind,
        title: i.title,
        nameEn: i.employee.nameEn,
        nameAr: i.employee.nameAr,
        expiresOn: i.expiresOn,
      },
    };
  });
  if (rows.length === 0) return { raised: 0 };
  const created = await db.alert.createMany({ data: rows, skipDuplicates: true });
  return { raised: created.count };
}

/** Open document alerts for HR (people limited to stores see only theirs). */
export async function listDocumentAlerts(db: Db, scope: StoreScope) {
  const alerts = await db.alert.findMany({
    where: {
      type: { in: ['document_expiring', 'document_expired'] },
      resolvedAt: null,
      ...(scope && { darkStoreId: { in: scope } }),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return alerts.map((a) => ({
    id: a.id,
    type: a.type,
    data: a.data as unknown,
    createdAt: a.createdAt,
  }));
}

export function resolveDocumentAlert(
  db: Db,
  input: { alertId: string; actorUserId: string; scope: StoreScope },
) {
  return inTransaction(db, async (tx) => {
    const alert = await tx.alert.findUnique({ where: { id: input.alertId } });
    if (!alert || !['document_expiring', 'document_expired'].includes(alert.type))
      throw new DomainError('alert_not_found', 404);
    if (input.scope && !(alert.darkStoreId && input.scope.includes(alert.darkStoreId)))
      throw new DomainError('store_not_allowed', 403);
    const done = await tx.alert.updateMany({
      where: { id: alert.id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: input.actorUserId },
    });
    if (done.count !== 1) throw new DomainError('alert_not_open', 409);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'alert.resolve',
      entityType: 'alert',
      entityId: alert.id,
      before: { resolved: false },
      after: { resolved: true },
    });
    return { resolved: true };
  });
}

// ─── history ───────────────────────────────────────────────────────────────────

/** Actions that carry pay: shown only with the salaries switch. */
const PAY_ACTIONS = ['finance.salary_set', 'finance.employment_set'];

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
  const rows = await db.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'employee', entityId: e.id },
        { entityType: 'user', entityId: e.userId },
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

import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  type AccessProfile,
  accountRoleFor,
  cairoDay,
  canDo,
  canUseStore,
  employeeCode,
  type HireDraftData,
  hireDraftDataSchema,
  type HireDraftSaveBody,
  hireAccessValues,
  type HireStep,
  hireStepIssues,
  hirePayBasis,
  hireSteps,
  isTeamRole,
  MAX_PHOTO_BYTES,
  normalizeEgyptianPhone,
  PHOTO_TYPES,
  probationEnd,
} from '@shiplynow/shared';
import { writeAccess } from './access';
import { mapUnique } from './admin-ops';
import { generateRoster } from './attendance';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { issueSetupToken } from './crm-proposals';
import { DomainError } from './domain-error';
import { startChecklist } from './hr-checklists';
import { addEmployeeDocument, departmentChains, isRequired, looksLike } from './hr-documents';
import { assertNoManagerLoop, checkPlacement } from './hr-org';
import { checkStaffingCompany } from './finance/rider-offices';
import { setSalaryPackage } from './hr-pay';
import { hashPassword } from './password';
import { getSetting } from './settings';

// HR phase 2 (docs/HR.md "Phase 2 as built"): the new hire wizard. HR fills a draft step by
// step (saved between steps, so they can come back); creating it makes the login (or none),
// the access profile, the file, the salary package, the photo and documents, the roster and
// the onboarding checklist in ONE transaction, once per idempotency key.

type StoreScope = string[] | null;

const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`) : null);
const dayText = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Accounts made without a login carry an address nobody can receive mail at. */
export const NO_LOGIN_DOMAIN = 'no-login.shiplynow.invalid';
export const isNoLoginEmail = (email: string) => email.endsWith(`@${NO_LOGIN_DOMAIN}`);

export interface HireActor {
  userId: string;
  access: AccessProfile;
  scope: StoreScope;
}

const fileSelect = {
  id: true,
  kind: true,
  typeId: true,
  title: true,
  issuedOn: true,
  expiresOn: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

function parseData(raw: Prisma.JsonValue): HireDraftData {
  const parsed = hireDraftDataSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : hireDraftDataSchema.parse({});
}

/** What a draft shows: the pay step only with the salaries switch. */
function draftView(
  d: Prisma.HireDraftGetPayload<{
    include: { files: { select: typeof fileSelect }; createdBy: { select: { name: true } } };
  }>,
  pay: boolean,
) {
  const data = parseData(d.data);
  const photo = d.files.find((f) => f.kind === 'photo') ?? null;
  return {
    id: d.id,
    status: d.status,
    step: d.step as HireStep,
    data: pay ? data : { ...data, pay: {} },
    hasPay: Object.keys(data.pay ?? {}).length > 0,
    employeeId: d.employeeId,
    payPending: d.payPending,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    photoVersion: photo ? photo.createdAt.getTime() : null,
    files: d.files
      .filter((f) => f.kind === 'document')
      .map((f) => ({ ...f, issuedOn: dayText(f.issuedOn), expiresOn: dayText(f.expiresOn) })),
  };
}
export type HireDraftView = ReturnType<typeof draftView>;

const draftInclude = {
  files: { select: fileSelect, orderBy: { createdAt: 'asc' } },
  createdBy: { select: { name: true } },
} as const;

/** A draft the person may work on: their own, or one for their stores (or any store). */
function inScope(scope: StoreScope, data: HireDraftData, createdById: string, userId: string) {
  if (scope === null || createdById === userId) return true;
  const stores = data.job?.storeIds ?? [];
  return stores.length > 0 && stores.every((s) => scope.includes(s));
}

async function loadDraft(tx: Db, draftId: string, actor: HireActor) {
  const d = await tx.hireDraft.findUnique({ where: { id: draftId }, include: draftInclude });
  if (!d) throw new DomainError('draft_not_found', 404);
  if (!inScope(actor.scope, parseData(d.data), d.createdById, actor.userId))
    throw new DomainError('store_not_allowed', 403);
  return d;
}

/** Pay typed in a save: refused without the salaries switch, kept as it was otherwise. */
function mergePay(next: HireDraftData, before: HireDraftData | null, pay: boolean) {
  if (pay) return next;
  if (Object.keys(next.pay ?? {}).length > 0) throw new DomainError('salaries_required', 403);
  return { ...next, pay: before?.pay ?? {} };
}

/** Open drafts in the person's stores, newest first (for the HR home). */
export async function listHireDrafts(db: Db, actor: HireActor) {
  const rows = await db.hireDraft.findMany({
    where: { status: 'open' },
    include: { createdBy: { select: { name: true } }, _count: { select: { files: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return rows
    .filter((d) => inScope(actor.scope, parseData(d.data), d.createdById, actor.userId))
    .map((d) => {
      const data = parseData(d.data);
      return {
        id: d.id,
        step: d.step as HireStep,
        name: data.person?.nameEn || null,
        nameAr: data.person?.nameAr || null,
        kind: data.job?.kind ?? null,
        hireDate: data.job?.hireDate ?? null,
        files: d._count.files,
        createdBy: d.createdBy.name,
        updatedAt: d.updatedAt,
      };
    });
}

/** People hired without the pay step whose package is still missing (salaries switch). */
export async function payPendingHires(db: Db, scope: StoreScope) {
  const rows = await db.hireDraft.findMany({
    where: {
      status: 'done',
      payPending: true,
      employee: {
        salaryPackages: { none: {} },
        employment: 'employee',
        payBasis: 'monthly_salary',
        status: { not: 'left' },
        ...(scope && { homeStoreId: { in: scope } }),
      },
    },
    select: {
      employee: {
        select: { id: true, number: true, nameEn: true, nameAr: true, hireDate: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return rows.map((r) => ({
    ...r.employee!,
    code: employeeCode(r.employee!.number),
    hireDate: dayText(r.employee!.hireDate),
  }));
}

export async function getHireDraft(db: Db, draftId: string, actor: HireActor) {
  return draftView(await loadDraft(db, draftId, actor), actor.access.salaries);
}

/** Starts a draft with what the first step holds. Audited. */
export function startHireDraft(db: Db, input: { body: HireDraftSaveBody; actor: HireActor }) {
  return inTransaction(db, async (tx) => {
    const data = mergePay(input.body.data, null, input.actor.access.salaries);
    if (!inScope(input.actor.scope, data, input.actor.userId, input.actor.userId))
      throw new DomainError('store_not_allowed', 403);
    const d = await tx.hireDraft.create({
      data: {
        step: input.body.step,
        data: data as Prisma.InputJsonValue,
        createdById: input.actor.userId,
      },
      include: draftInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actor.userId,
      action: 'hire_draft.start',
      entityType: 'hire_draft',
      entityId: d.id,
      after: { name: data.person?.nameEn ?? null },
    });
    return draftView(d, input.actor.access.salaries);
  });
}

/** Saves what the steps hold and the step reached (only while the draft is open). */
export function saveHireDraft(
  db: Db,
  input: { draftId: string; body: HireDraftSaveBody; actor: HireActor },
) {
  return inTransaction(db, async (tx) => {
    const before = await loadDraft(tx, input.draftId, input.actor);
    if (before.status !== 'open') throw new DomainError('draft_closed', 409);
    const data = mergePay(input.body.data, parseData(before.data), input.actor.access.salaries);
    if (!inScope(input.actor.scope, data, before.createdById, input.actor.userId))
      throw new DomainError('store_not_allowed', 403);
    const d = await tx.hireDraft.update({
      where: { id: before.id },
      data: { step: input.body.step, data: data as Prisma.InputJsonValue },
      include: draftInclude,
    });
    return draftView(d, input.actor.access.salaries);
  });
}

/** Throws a draft away (its files go with it). Audited. */
export function discardHireDraft(db: Db, input: { draftId: string; actor: HireActor }) {
  return inTransaction(db, async (tx) => {
    const d = await loadDraft(tx, input.draftId, input.actor);
    if (d.status !== 'open') throw new DomainError('draft_closed', 409);
    await tx.hireDraftFile.deleteMany({ where: { draftId: d.id } });
    await tx.hireDraft.update({ where: { id: d.id }, data: { status: 'discarded' } });
    await recordAudit(tx, {
      actorUserId: input.actor.userId,
      action: 'hire_draft.discard',
      entityType: 'hire_draft',
      entityId: d.id,
      after: { name: parseData(d.data).person?.nameEn ?? null },
    });
    return { discarded: true };
  });
}

/**
 * Adds the photo (one per draft, replaced) or a document to a draft, checked like an upload to
 * a file: the type's formats, size and expiry.
 */
export function addHireDraftFile(
  db: Db,
  input: {
    draftId: string;
    kind: 'photo' | 'document';
    typeId?: string;
    title?: string;
    issuedOn?: string;
    expiresOn?: string;
    contentType: string;
    data: Buffer;
    actor: HireActor;
  },
) {
  return inTransaction(db, async (tx) => {
    const d = await loadDraft(tx, input.draftId, input.actor);
    if (d.status !== 'open') throw new DomainError('draft_closed', 409);
    if (input.kind === 'photo') {
      if (!(PHOTO_TYPES as readonly string[]).includes(input.contentType))
        throw new DomainError('photo_type_not_allowed', 400);
      if (input.data.length === 0 || input.data.length > MAX_PHOTO_BYTES)
        throw new DomainError('photo_too_large', 400);
      if (!looksLike(input.contentType, input.data))
        throw new DomainError('photo_not_readable', 400);
      await tx.hireDraftFile.deleteMany({ where: { draftId: d.id, kind: 'photo' } });
    } else {
      const type = input.typeId
        ? await tx.employeeDocumentType.findUnique({ where: { id: input.typeId } })
        : null;
      if (!type || !type.isActive) throw new DomainError('document_type_not_found', 404);
      if (!type.allowedTypes.includes(input.contentType))
        throw new DomainError('document_type_not_allowed', 400);
      if (input.data.length === 0) throw new DomainError('document_empty', 400);
      if (input.data.length > type.maxBytes) throw new DomainError('document_too_large', 400);
      if (!looksLike(input.contentType, input.data))
        throw new DomainError('document_not_readable', 400);
      if (input.issuedOn && input.expiresOn && input.expiresOn < input.issuedOn)
        throw new DomainError('expires_before_issued', 400);
      if (type.hasExpiry && !input.expiresOn) throw new DomainError('expiry_required', 400);
    }
    const f = await tx.hireDraftFile.create({
      data: {
        draftId: d.id,
        kind: input.kind,
        typeId: input.kind === 'document' ? input.typeId! : null,
        title: input.title || null,
        issuedOn: toDate(input.issuedOn),
        expiresOn: toDate(input.expiresOn),
        contentType: input.contentType,
        data: new Uint8Array(input.data),
        sizeBytes: input.data.length,
      },
      select: fileSelect,
    });
    await tx.hireDraft.update({ where: { id: d.id }, data: { updatedAt: new Date() } });
    return { ...f, issuedOn: dayText(f.issuedOn), expiresOn: dayText(f.expiresOn) };
  });
}

export function deleteHireDraftFile(
  db: Db,
  input: { draftId: string; fileId: string; actor: HireActor },
) {
  return inTransaction(db, async (tx) => {
    const d = await loadDraft(tx, input.draftId, input.actor);
    if (d.status !== 'open') throw new DomainError('draft_closed', 409);
    const gone = await tx.hireDraftFile.deleteMany({
      where: { id: input.fileId, draftId: d.id },
    });
    if (gone.count === 0) throw new DomainError('document_not_found', 404);
    return { deleted: true };
  });
}

/** The bytes of a draft's photo or document (to show it while the wizard is open). */
export async function getHireDraftFile(
  db: Db,
  input: { draftId: string; fileId?: string; actor: HireActor },
) {
  await loadDraft(db, input.draftId, input.actor);
  const f = await db.hireDraftFile.findFirst({
    where: input.fileId
      ? { id: input.fileId, draftId: input.draftId }
      : { draftId: input.draftId, kind: 'photo' },
  });
  if (!f) throw new DomainError(input.fileId ? 'document_not_found' : 'photo_not_found', 404);
  return f;
}

/**
 * The document types required of a person placed like this (employment, department with the
 * ones above it, position), for the wizard's documents step. Confidential types only with HR use.
 */
export async function requiredDocumentTypes(
  db: Db,
  placement: { employment: string; departmentId: string | null; positionId: string | null },
  options: { confidential: boolean },
) {
  let departmentId = placement.departmentId;
  if (!departmentId && placement.positionId)
    departmentId =
      (
        await db.jobPosition.findUnique({
          where: { id: placement.positionId },
          select: { departmentId: true },
        })
      )?.departmentId ?? null;
  const [types, chainOf] = await Promise.all([
    db.employeeDocumentType.findMany({
      where: { isActive: true },
      orderBy: [{ sort: 'asc' }, { nameEn: 'asc' }],
    }),
    departmentChains(db),
  ]);
  const chain = chainOf(departmentId);
  return types
    .filter((t) => options.confidential || !t.confidential)
    .map((t) => ({
      id: t.id,
      code: t.code,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      hasExpiry: t.hasExpiry,
      multiple: t.multiple,
      allowedTypes: t.allowedTypes,
      maxBytes: t.maxBytes,
      required: isRequired(
        t,
        { employment: placement.employment, departmentId, positionId: placement.positionId },
        chain,
      ),
    }));
}

/** Who may be given what on the access step (docs/ACCESS.md "HR phase 2"). */
function checkGrant(
  actor: AccessProfile,
  values: ReturnType<typeof hireAccessValues>,
  storeIds: string[],
) {
  // Settings manage (owners) is given only by someone who holds it.
  if (values.settings === 'manage' && !canDo(actor, 'settings', 'manage'))
    throw new DomainError('access_needs_settings', 403);
  if (values.salaries && !actor.salaries) throw new DomainError('salaries_required', 403);
  if (values.customerData && !actor.customerData && !canDo(actor, 'settings', 'manage'))
    throw new DomainError('access_needs_settings', 403);
  // Someone limited to some stores gives only their stores.
  if (!actor.allStores) {
    if (values.allStores) throw new DomainError('store_not_allowed', 403);
    if (storeIds.some((s) => !canUseStore(actor, s)))
      throw new DomainError('store_not_allowed', 403);
  }
}

const uniq = (ids: string[]) => [...new Set(ids.filter(Boolean))];

/**
 * Creates the person from a draft in ONE transaction: the login (inactive until they choose a
 * password through a one time setup link) or an account without a login, the access profile,
 * the employee file (EMP number), the salary package (salaries switch; otherwise flagged for an
 * HR manager), the photo and the documents, the roster from the default shift and the
 * onboarding checklist. A retry with the same key answers the same file without a new link.
 */
export async function createHireFromDraft(
  db: Db,
  input: { draftId: string; idempotencyKey: string; actor: HireActor; now?: Date },
) {
  const now = input.now ?? new Date();
  // Hashing is slow: a random password nobody knows, made before the transaction.
  const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
  return mapUnique(() =>
    inTransaction(db, async (tx) => {
      const seen = await tx.hireDraft.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { employee: { select: { id: true, number: true, userId: true } } },
      });
      if (seen) {
        if (seen.id !== input.draftId) throw new DomainError('idempotency_key_reused', 409);
        return {
          employeeId: seen.employee!.id,
          code: employeeCode(seen.employee!.number),
          userId: seen.employee!.userId,
          setupToken: null,
          payPending: seen.payPending,
          repeated: true,
        };
      }
      await tx.$queryRaw`SELECT id FROM hire_drafts WHERE id = ${input.draftId} FOR UPDATE`;
      const draft = await loadDraft(tx, input.draftId, input.actor);
      if (draft.status === 'done') throw new DomainError('draft_already_created', 409);
      if (draft.status !== 'open') throw new DomainError('draft_closed', 409);
      const data = parseData(draft.data);
      const p = data.person;
      const j = data.job;
      const a = data.access;
      const today = cairoDay(now);
      const canPay = input.actor.access.salaries;
      const payBasis = hirePayBasis(j);
      const steps = hireSteps({ canPay, employment: j.employment, payBasis });
      const issues = hireStepIssues(data, 'review', { today, steps });
      if (Object.keys(issues).length > 0)
        throw new DomainError('draft_incomplete', 400, { fields: Object.keys(issues).join(',') });
      // Pay typed by someone with the switch cannot be dropped by someone without it.
      if (!canPay && Object.keys(data.pay).length > 0)
        throw new DomainError('salaries_required', 403);

      const kind = j.kind!;
      const login = kind === 'rider' || Boolean(a.login);
      const jobStores = uniq(j.storeIds ?? []);
      for (const s of jobStores) {
        if (!(await tx.darkStore.findUnique({ where: { id: s } })))
          throw new DomainError('dark_store_not_found', 404);
        if (input.actor.scope !== null && !input.actor.scope.includes(s))
          throw new DomainError('store_not_allowed', 403);
      }
      if (input.actor.scope !== null && jobStores.length === 0)
        throw new DomainError('store_not_allowed', 403);
      const role = login ? accountRoleFor(kind, a.jobRole) : ('admin' as const);
      const accessValues = login && kind === 'team' ? hireAccessValues(a) : null;
      const accessStores = accessValues
        ? accessValues.allStores
          ? []
          : uniq(a.storeIds?.length ? a.storeIds : jobStores)
        : [];
      if (accessValues) checkGrant(input.actor.access, accessValues, accessStores);
      const userStore = role === 'store_staff' || role === 'rider' ? (jobStores[0] ?? null) : null;
      if ((role === 'store_staff' || role === 'rider') && !userStore)
        throw new DomainError('dark_store_required', 400);

      const mobile = p.mobile ? normalizeEgyptianPhone(p.mobile) : null;
      const email = login
        ? p.email!.trim().toLowerCase()
        : `no-login-${randomUUID()}@${NO_LOGIN_DOMAIN}`;
      const user = await tx.user.create({
        data: {
          email,
          name: p.nameEn!.trim(),
          phone: mobile,
          role,
          passwordHash,
          isActive: false,
          darkStoreId: userStore,
        },
      });
      if (role === 'rider')
        await tx.rider.create({
          data: {
            userId: user.id,
            darkStoreId: userStore!,
            badgeCode: j.badgeCode!.trim().toUpperCase(),
          },
        });
      const access = accessValues
        ? await writeAccess(tx, user.id, accessValues, accessStores)
        : null;

      // The file.
      if (j.managerId) {
        const m = await tx.employee.findUnique({ where: { id: j.managerId } });
        if (!m || m.status === 'left') throw new DomainError('manager_not_found', 404);
      }
      if (j.employment === 'outsourced') {
        const s = await tx.supplier.findUnique({ where: { id: j.staffingSupplierId! } });
        if (!s) throw new DomainError('staffing_company_not_found', 404);
        // Riders paid per delivery go through a rider office, and offices take only them.
        await checkStaffingCompany(tx, { supplierId: s.id, role, payBasis });
      }
      if (j.defaultShiftId) {
        const shift = await tx.shift.findUnique({ where: { id: j.defaultShiftId } });
        if (!shift || !shift.isActive) throw new DomainError('shift_not_found', 404);
      }
      const { position } = await checkPlacement(tx, {
        departmentId: j.departmentId || null,
        positionId: j.positionId || null,
        gradeId: j.gradeId || null,
      });
      const months = await getSetting(tx, 'hr.probation_months');
      const probation =
        j.probationEndsOn ||
        probationEnd({ probationEndsOn: null, hireDate: j.hireDate!, months }) ||
        null;
      const pay = data.pay;
      const bank = canPay && j.employment !== 'outsourced' && payBasis === 'monthly_salary';
      const employee = await tx.employee.create({
        data: {
          userId: user.id,
          nameEn: p.nameEn!.trim(),
          nameAr: p.nameAr?.trim() || null,
          nationalId: p.nationalId?.trim() || null,
          birthDate: toDate(p.birthDate),
          address: p.address?.trim() || null,
          emergencyName: p.emergencyName?.trim() || null,
          emergencyPhone: p.emergencyPhone ? normalizeEgyptianPhone(p.emergencyPhone) : null,
          jobTitle: j.jobTitle?.trim() || null,
          departmentId: j.departmentId || position?.departmentId || null,
          positionId: j.positionId || null,
          gradeId: j.gradeId || null,
          managerId: j.managerId || null,
          homeStoreId: jobStores[0] ?? null,
          hireDate: toDate(j.hireDate),
          employment: j.employment ?? 'employee',
          payBasis,
          staffingSupplierId: j.employment === 'outsourced' ? j.staffingSupplierId! : null,
          contractType:
            j.employment === 'outsourced' ? 'outsourced' : (j.contractType ?? 'permanent'),
          contractEndsOn: toDate(j.contractEndsOn),
          probationEndsOn: toDate(probation),
          defaultShiftId: j.defaultShiftId || null,
          status: 'active',
          ...(bank && {
            bankName: pay.bankName?.trim() || null,
            bankAccountNumber: pay.bankAccountNumber?.trim() || null,
            iban: pay.iban ? pay.iban.replace(/\s+/g, '').toUpperCase() : null,
            bankAccountHolder: pay.bankAccountHolder?.trim() || null,
          }),
        },
      });
      await assertNoManagerLoop(tx);
      await recordAudit(tx, {
        actorUserId: input.actor.userId,
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        after: {
          email: login ? email : null,
          name: user.name,
          phone: user.phone,
          role,
          isActive: false,
          darkStoreId: userStore,
          badgeCode: role === 'rider' ? j.badgeCode!.toUpperCase() : null,
          login,
          access: access ? ({ ...access } as unknown as Prisma.InputJsonValue) : null,
          hireDraftId: draft.id,
        },
      });

      // Pay: a package from the hire date, else flagged for an HR manager with salaries.
      // Riders paid per delivered order need no package (they earn through the rider wallet).
      const onPayroll =
        (j.employment ?? 'employee') === 'employee' && payBasis === 'monthly_salary';
      let payPending = false;
      if (onPayroll && canPay)
        await setSalaryPackage(tx, {
          employeeId: employee.id,
          body: {
            effectiveFrom: j.hireDate!,
            basicPiastres: pay.basicPiastres!,
            insuredWagePiastres: pay.insuredWagePiastres ?? null,
            allowances: (pay.allowances ?? []).map((x) => ({
              kind: x.kind,
              label: x.label,
              amountPiastres: x.amountPiastres,
            })),
            note: 'New hire',
          },
          actorUserId: input.actor.userId,
        });
      else if (onPayroll) payPending = true;

      // The photo and the documents typed in the wizard.
      const files = await tx.hireDraftFile.findMany({
        where: { draftId: draft.id },
        orderBy: { createdAt: 'asc' },
      });
      const photo = files.find((f) => f.kind === 'photo');
      if (photo)
        await tx.employeePhoto.create({
          data: {
            employeeId: employee.id,
            contentType: photo.contentType,
            data: photo.data,
            sizeBytes: photo.sizeBytes,
          },
        });
      let documents = 0;
      for (const f of files.filter((x) => x.kind === 'document')) {
        await addEmployeeDocument(tx, {
          employeeId: employee.id,
          typeId: f.typeId!,
          title: f.title ?? undefined,
          issuedOn: dayText(f.issuedOn) ?? undefined,
          expiresOn: dayText(f.expiresOn) ?? undefined,
          contentType: f.contentType,
          data: Buffer.from(f.data),
          actorUserId: input.actor.userId,
          scope: null,
        });
        documents++;
      }

      // The roster from the default shift: two weeks from the hire day (or today); the
      // attendance job keeps planning ahead from then on.
      if (employee.defaultShiftId)
        await generateRoster(tx, {
          from: j.hireDate! > today ? j.hireDate! : today,
          days: 14,
          employeeIds: [employee.id],
          actorUserId: input.actor.userId,
        });
      // Onboarding from the position's template (else the default).
      const checklist = await startChecklist(tx, {
        employeeId: employee.id,
        body: { kind: 'onboarding' },
        actorUserId: input.actor.userId,
      });

      let setupToken: string | null = null;
      if (login)
        setupToken = await issueSetupToken(
          tx,
          user.id,
          input.actor.userId,
          now,
          await getSetting(tx, 'hr.setup_link_days'),
        );

      await recordAudit(tx, {
        actorUserId: input.actor.userId,
        action: 'employee.hire',
        entityType: 'employee',
        entityId: employee.id,
        after: {
          hireDraftId: draft.id,
          nameEn: employee.nameEn,
          kind,
          login,
          jobRole: access?.jobRole ?? null,
          departmentId: employee.departmentId,
          positionId: employee.positionId,
          gradeId: employee.gradeId,
          managerId: employee.managerId,
          homeStoreId: employee.homeStoreId,
          hireDate: j.hireDate!,
          employment: employee.employment,
          payBasis,
          probationEndsOn: probation,
          defaultShiftId: employee.defaultShiftId,
          documents,
          photo: Boolean(photo),
          onboarding: checklist ? checklist.id : null,
          payPending,
        },
      });
      await tx.hireDraftFile.deleteMany({ where: { draftId: draft.id } });
      await tx.hireDraft.update({
        where: { id: draft.id },
        data: {
          status: 'done',
          step: 'review',
          employeeId: employee.id,
          idempotencyKey: input.idempotencyKey,
          payPending,
          // Pay figures are on the file now; the draft keeps the rest for reference.
          data: { ...data, pay: {} } as Prisma.InputJsonValue,
        },
      });
      return {
        employeeId: employee.id,
        code: employeeCode(employee.number),
        userId: user.id,
        setupToken,
        payPending,
        repeated: false,
      };
    }),
  );
}

/**
 * A new one time setup link for someone hired with a login who has not chosen a password yet
 * (the first was lost or ran out). Earlier links stop working. HR use; audited.
 */
export function issueEmployeeSetupLink(
  db: Db,
  input: { employeeId: string; actorUserId: string; scope: StoreScope; now?: Date },
) {
  const now = input.now ?? new Date();
  return inTransaction(db, async (tx) => {
    const e = await tx.employee.findUnique({
      where: { id: input.employeeId },
      include: { user: true },
    });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (input.scope !== null && !(e.homeStoreId && input.scope.includes(e.homeStoreId)))
      throw new DomainError('store_not_allowed', 403);
    if (e.status === 'left') throw new DomainError('employee_left', 409);
    if (isNoLoginEmail(e.user.email)) throw new DomainError('no_login', 409);
    if (e.user.isActive) throw new DomainError('login_already_active', 409);
    const made = await tx.userSetupToken.count({ where: { userId: e.userId } });
    if (made === 0) throw new DomainError('login_not_pending', 409);
    const token = await issueSetupToken(
      tx,
      e.userId,
      input.actorUserId,
      now,
      await getSetting(tx, 'hr.setup_link_days'),
    );
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'user.setup_link',
      entityType: 'user',
      entityId: e.userId,
      after: { employeeId: e.id },
    });
    return { setupToken: token };
  });
}

/** Whether a file's login waits for its setup link, or has none at all. */
export async function loginStateOf(db: Db, userId: string) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, isActive: true, role: true },
  });
  if (!u) return 'none' as const;
  if (isNoLoginEmail(u.email)) return 'none' as const;
  if (u.isActive) return 'active' as const;
  const pending = await db.userSetupToken.count({ where: { userId, usedAt: null } });
  if (pending > 0 && (isTeamRole(u.role) || u.role === 'rider')) return 'pending' as const;
  return 'disabled' as const;
}

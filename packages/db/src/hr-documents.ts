import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  type DocumentReviewBody,
  type DocumentState,
  type DocumentTypeBody,
  type DocumentTypeUpdateBody,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { completeDocumentTasks } from './hr-checklists';
import { assertFileInScope, type StoreScope } from './hr';
import { getSetting } from './settings';

// HR v2 (docs/HR.md): document types as settings rows, a checklist per person (required,
// missing, uploaded, verified, expiring, expired), versions that keep the old copies, HR
// verification, self service uploads from My HR, expiry alerts per type, and the photo.

type Tx = Prisma.TransactionClient;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`) : null);

/** The first bytes every file of each allowed type starts with. */
export function looksLike(contentType: string, data: Buffer) {
  const starts = (bytes: number[], at = 0) => bytes.every((b, i) => data[at + i] === b);
  if (contentType === 'image/jpeg') return starts([0xff, 0xd8, 0xff]);
  if (contentType === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === 'image/webp')
    return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
  if (contentType === 'application/pdf') return starts([0x25, 0x50, 0x44, 0x46]); // %PDF
  return false;
}

// ─── document types ────────────────────────────────────────────────────────────

export async function listDocumentTypes(db: Db, options: { activeOnly?: boolean } = {}) {
  return db.employeeDocumentType.findMany({
    where: options.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
}

const typeSnapshot = (t: Prisma.EmployeeDocumentTypeGetPayload<object>) => {
  const { createdAt: _c, updatedAt: _u, id: _i, ...rest } = t;
  return rest;
};

export function createDocumentType(db: Db, input: { body: DocumentTypeBody; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    if (await tx.employeeDocumentType.findUnique({ where: { code: input.body.code } }))
      throw new DomainError('code_taken', 409);
    if (input.body.hasExpiry === false && input.body.alertDays != null)
      throw new DomainError('alert_without_expiry', 400);
    const t = await tx.employeeDocumentType.create({ data: input.body });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'document_type.create',
      entityType: 'document_type',
      entityId: t.id,
      after: typeSnapshot(t),
    });
    return t;
  });
}

export function updateDocumentType(
  db: Db,
  input: { id: string; body: DocumentTypeUpdateBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.employeeDocumentType.findUnique({ where: { id: input.id } });
    if (!before) throw new DomainError('document_type_not_found', 404);
    const after = await tx.employeeDocumentType.update({
      where: { id: before.id },
      data: input.body,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'document_type.update',
      entityType: 'document_type',
      entityId: before.id,
      before: typeSnapshot(before),
      after: typeSnapshot(after),
    });
    return after;
  });
}

// ─── who needs what ────────────────────────────────────────────────────────────

type DocType = Prisma.EmployeeDocumentTypeGetPayload<object>;
interface Placement {
  employment: string;
  departmentId: string | null;
  positionId: string | null;
}

/** A department and every department above it (a rule for Operations covers Dark stores). */
export async function departmentChains(db: Db) {
  const rows = await db.department.findMany({ select: { id: true, parentId: true } });
  const parent = new Map(rows.map((d) => [d.id, d.parentId]));
  return (id: string | null) => {
    const chain: string[] = [];
    for (let c = id, i = 0; c && i < 50; i++, c = parent.get(c) ?? null) chain.push(c);
    return chain;
  };
}

/** Whether a type is required of a person: on, and every non empty list matches them. */
export function isRequired(t: DocType, p: Placement, departments: string[]) {
  if (!t.required || !t.isActive) return false;
  if (t.requiredEmployment.length && !t.requiredEmployment.includes(p.employment)) return false;
  if (
    t.requiredDepartmentIds.length &&
    !t.requiredDepartmentIds.some((d) => departments.includes(d))
  )
    return false;
  if (
    t.requiredPositionIds.length &&
    !(p.positionId && t.requiredPositionIds.includes(p.positionId))
  )
    return false;
  return true;
}

const docSelect = {
  id: true,
  typeId: true,
  title: true,
  contentType: true,
  sizeBytes: true,
  issuedOn: true,
  expiresOn: true,
  version: true,
  previousId: true,
  isCurrent: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  selfUploaded: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  type: { select: { id: true, code: true, nameEn: true, nameAr: true, confidential: true } },
} as const;
type DocRow = Prisma.EmployeeDocumentGetPayload<{ select: typeof docSelect }>;

function docView(d: DocRow) {
  return {
    ...d,
    issuedOn: day(d.issuedOn),
    expiresOn: day(d.expiresOn),
  };
}
export type EmployeeDocumentView = ReturnType<typeof docView>;

/** Where a current document stands today (or missing without one). */
export function documentState(
  doc: { status: string; expiresOn: Date | string | null } | null,
  today: string,
  alertDays: number,
): DocumentState {
  if (!doc) return 'missing';
  if (doc.status === 'rejected') return 'rejected';
  const expires = typeof doc.expiresOn === 'string' ? doc.expiresOn : day(doc.expiresOn);
  if (expires && expires < today) return 'expired';
  if (doc.status === 'pending') return 'pending';
  if (expires && expires <= addDays(today, alertDays)) return 'expiring';
  return 'verified';
}
/** Still valid on the file: what the completeness counts. */
const isDone = (s: DocumentState) => s === 'verified' || s === 'expiring';

/**
 * The checklist of one file: every active type that is required of the person or already on
 * the file, with its state and its current document. Completeness is the share of required
 * types holding a valid, verified document.
 */
export async function documentChecklist(
  db: Db,
  employeeId: string,
  options: { confidential: boolean },
) {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employment: true, departmentId: true, positionId: true },
  });
  if (!e) throw new DomainError('employee_not_found', 404);
  const [types, docs, chainOf, defaultDays] = await Promise.all([
    listDocumentTypes(db, { activeOnly: true }),
    db.employeeDocument.findMany({
      where: { employeeId, isCurrent: true },
      select: docSelect,
      orderBy: { createdAt: 'desc' },
    }),
    departmentChains(db),
    getSetting(db, 'hr.document_alert_days'),
  ]);
  const today = cairoDay(new Date());
  const chain = chainOf(e.departmentId);
  const items = types
    .filter((t) => options.confidential || !t.confidential)
    .map((t) => {
      const required = isRequired(t, e, chain);
      const current = docs.filter((d) => d.typeId === t.id);
      const latest = current[0] ?? null;
      const state = documentState(latest, today, t.alertDays ?? defaultDays);
      return {
        type: {
          id: t.id,
          code: t.code,
          nameEn: t.nameEn,
          nameAr: t.nameAr,
          hasExpiry: t.hasExpiry,
          multiple: t.multiple,
          selfUpload: t.selfUpload,
          confidential: t.confidential,
          allowedTypes: t.allowedTypes,
          maxBytes: t.maxBytes,
        },
        required,
        state,
        documents: current.map(docView),
      };
    })
    .filter((i) => i.required || i.documents.length > 0);
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => isDone(i.state)).length;
  return {
    items,
    required: required.length,
    done,
    percent: required.length === 0 ? 100 : Math.round((done / required.length) * 100),
  };
}

/** Completeness per person for the directory (no document bytes are read). */
export async function completenessFor(db: Db, employeeIds: string[]) {
  if (employeeIds.length === 0) return new Map<string, { percent: number; missing: number }>();
  const [people, types, docs, chainOf, defaultDays] = await Promise.all([
    db.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, employment: true, departmentId: true, positionId: true },
    }),
    listDocumentTypes(db, { activeOnly: true }),
    db.employeeDocument.findMany({
      where: { employeeId: { in: employeeIds }, isCurrent: true },
      select: { employeeId: true, typeId: true, status: true, expiresOn: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    departmentChains(db),
    getSetting(db, 'hr.document_alert_days'),
  ]);
  const today = cairoDay(new Date());
  const result = new Map<string, { percent: number; missing: number }>();
  for (const p of people) {
    const chain = chainOf(p.departmentId);
    const required = types.filter((t) => isRequired(t, p, chain));
    let done = 0;
    for (const t of required) {
      const doc = docs.find((d) => d.employeeId === p.id && d.typeId === t.id) ?? null;
      if (isDone(documentState(doc, today, t.alertDays ?? defaultDays))) done++;
    }
    result.set(p.id, {
      percent: required.length === 0 ? 100 : Math.round((done / required.length) * 100),
      missing: required.length - done,
    });
  }
  return result;
}

/**
 * Every required document not in order across the company (missing, waiting for HR, rejected,
 * expired or about to expire), one row per person and type, for the bulk view and its CSV.
 */
export async function missingDocuments(
  db: Db,
  filter: { scope: StoreScope; departmentId?: string; typeId?: string; state?: DocumentState },
) {
  const people = await db.employee.findMany({
    where: {
      status: { not: 'left' },
      ...(filter.scope && { homeStoreId: { in: filter.scope } }),
    },
    select: {
      id: true,
      number: true,
      nameEn: true,
      nameAr: true,
      employment: true,
      departmentId: true,
      positionId: true,
      department: { select: { id: true, nameEn: true, nameAr: true } },
      homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
    orderBy: { nameEn: 'asc' },
  });
  const [types, docs, chainOf, defaultDays] = await Promise.all([
    listDocumentTypes(db, { activeOnly: true }),
    db.employeeDocument.findMany({
      where: { employeeId: { in: people.map((p) => p.id) }, isCurrent: true },
      select: {
        id: true,
        employeeId: true,
        typeId: true,
        status: true,
        expiresOn: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    departmentChains(db),
    getSetting(db, 'hr.document_alert_days'),
  ]);
  const today = cairoDay(new Date());
  const rows = [];
  for (const p of people) {
    const chain = chainOf(p.departmentId);
    if (filter.departmentId && !chain.includes(filter.departmentId)) continue;
    for (const t of types) {
      if (filter.typeId && t.id !== filter.typeId) continue;
      if (!isRequired(t, p, chain)) continue;
      const doc = docs.find((d) => d.employeeId === p.id && d.typeId === t.id) ?? null;
      const state = documentState(doc, today, t.alertDays ?? defaultDays);
      if (state === 'verified') continue;
      if (filter.state && filter.state !== state) continue;
      rows.push({
        employee: {
          id: p.id,
          number: p.number,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          department: p.department,
          homeStore: p.homeStore,
        },
        type: { id: t.id, code: t.code, nameEn: t.nameEn, nameAr: t.nameAr },
        state,
        documentId: doc?.id ?? null,
        expiresOn: day(doc?.expiresOn),
      });
    }
  }
  return rows;
}

/** Documents people uploaded themselves that wait for HR. */
export async function pendingDocuments(db: Db, scope: StoreScope) {
  const docs = await db.employeeDocument.findMany({
    where: {
      isCurrent: true,
      status: 'pending',
      employee: { status: { not: 'left' }, ...(scope && { homeStoreId: { in: scope } }) },
    },
    select: {
      ...docSelect,
      employee: { select: { id: true, number: true, nameEn: true, nameAr: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  return docs.map((d) => ({ ...docView(d), employee: d.employee }));
}

// ─── upload, versions, review ──────────────────────────────────────────────────

export interface UploadInput {
  employeeId: string;
  typeId: string;
  title?: string;
  issuedOn?: string;
  expiresOn?: string;
  replacesId?: string;
  contentType: string;
  data: Buffer;
  actorUserId: string;
  scope: StoreScope;
  /** Uploaded by the person from My HR: waits for HR to verify */
  self?: boolean;
}

/**
 * Adds a document. A type kept once per person (not `multiple`) makes the upload a new version
 * of the current one, which stays in the history; `replacesId` names the version to replace for
 * types with several documents. HR uploads count as verified (HR saw the original); uploads
 * from My HR wait for HR to verify them.
 */
export async function addEmployeeDocument(db: Db, input: UploadInput) {
  return inTransaction(db, async (tx) => {
    await assertFileInScope(tx, input.employeeId, input.scope);
    const type = await tx.employeeDocumentType.findUnique({ where: { id: input.typeId } });
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

    let previous: { id: string; version: number; status: string; expiresOn: Date | null } | null =
      null;
    if (input.replacesId) {
      previous = await tx.employeeDocument.findFirst({
        where: {
          id: input.replacesId,
          employeeId: input.employeeId,
          typeId: type.id,
          isCurrent: true,
        },
        select: { id: true, version: true, status: true, expiresOn: true },
      });
      if (!previous) throw new DomainError('document_not_found', 404);
    } else if (!type.multiple) {
      previous = await tx.employeeDocument.findFirst({
        where: { employeeId: input.employeeId, typeId: type.id, isCurrent: true },
        select: { id: true, version: true, status: true, expiresOn: true },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (input.self) {
      if (!type.selfUpload || type.confidential)
        throw new DomainError('self_upload_not_allowed', 403);
      // The person fills a gap: nothing yet, refused, or out of date. A valid or waiting
      // document is HR's to replace.
      const days = type.alertDays ?? (await getSetting(tx, 'hr.document_alert_days'));
      const state = previous ? documentState(previous, cairoDay(new Date()), days) : 'missing';
      if (state === 'verified' || state === 'pending')
        throw new DomainError('document_already_on_file', 409);
    }
    if (previous)
      await tx.employeeDocument.update({ where: { id: previous.id }, data: { isCurrent: false } });
    const now = new Date();
    const doc = await tx.employeeDocument.create({
      data: {
        employeeId: input.employeeId,
        typeId: type.id,
        title: input.title || null,
        contentType: input.contentType,
        data: new Uint8Array(input.data),
        sizeBytes: input.data.length,
        issuedOn: toDate(input.issuedOn),
        expiresOn: toDate(input.expiresOn),
        version: previous ? previous.version + 1 : 1,
        previousId: previous?.id ?? null,
        status: input.self ? 'pending' : 'verified',
        reviewedById: input.self ? null : input.actorUserId,
        reviewedAt: input.self ? null : now,
        selfUploaded: Boolean(input.self),
        uploadedById: input.actorUserId,
      },
      select: docSelect,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.self ? 'employee.document_self_upload' : 'employee.document_add',
      entityType: 'employee',
      entityId: input.employeeId,
      after: {
        documentId: doc.id,
        type: type.code,
        title: doc.title,
        version: doc.version,
        status: doc.status,
        issuedOn: day(doc.issuedOn),
        expiresOn: day(doc.expiresOn),
        sizeBytes: doc.sizeBytes,
      },
    });
    if (doc.status === 'verified')
      await completeDocumentTasks(tx, input.employeeId, type.id, input.actorUserId);
    return docView(doc);
  });
}

/** HR marks the current version verified, or rejected with a note the person sees. */
export function reviewEmployeeDocument(
  db: Db,
  input: {
    employeeId: string;
    documentId: string;
    body: DocumentReviewBody;
    actorUserId: string;
    scope: StoreScope;
  },
) {
  return inTransaction(db, async (tx) => {
    await assertFileInScope(tx, input.employeeId, input.scope);
    const doc = await tx.employeeDocument.findFirst({
      where: { id: input.documentId, employeeId: input.employeeId },
      select: docSelect,
    });
    if (!doc) throw new DomainError('document_not_found', 404);
    if (!doc.isCurrent) throw new DomainError('document_not_current', 409);
    if (doc.status === input.body.status) throw new DomainError('status_unchanged', 409);
    const after = await tx.employeeDocument.update({
      where: { id: doc.id },
      data: {
        status: input.body.status,
        reviewNote: input.body.note || null,
        reviewedById: input.actorUserId,
        reviewedAt: new Date(),
      },
      select: docSelect,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.document_review',
      entityType: 'employee',
      entityId: input.employeeId,
      before: { documentId: doc.id, type: doc.type.code, status: doc.status },
      after: {
        documentId: doc.id,
        type: doc.type.code,
        status: after.status,
        note: after.reviewNote,
      },
    });
    if (after.status === 'verified')
      await completeDocumentTasks(tx, input.employeeId, doc.typeId, input.actorUserId);
    return docView(after);
  });
}

/** Every version of every document on a file, newest first (confidential types only for HR use). */
export async function listEmployeeDocuments(
  db: Db,
  employeeId: string,
  options: { scope: StoreScope; confidential: boolean },
) {
  await assertFileInScope(db, employeeId, options.scope);
  const docs = await db.employeeDocument.findMany({
    where: {
      employeeId,
      ...(!options.confidential && { type: { confidential: false } }),
    },
    select: docSelect,
    orderBy: [{ createdAt: 'desc' }],
  });
  return docs.map(docView);
}

/** One document with its bytes, for viewing or download. */
export async function getEmployeeDocument(
  db: Db,
  input: { employeeId: string; documentId: string; scope: StoreScope; confidential: boolean },
) {
  await assertFileInScope(db, input.employeeId, input.scope);
  const doc = await db.employeeDocument.findFirst({
    where: { id: input.documentId, employeeId: input.employeeId },
    include: { type: { select: { code: true, confidential: true } } },
  });
  if (!doc) throw new DomainError('document_not_found', 404);
  if (doc.type.confidential && !input.confidential)
    throw new DomainError('document_not_found', 404);
  return doc;
}

/**
 * Deletes one version (HR manage), audited. Deleting the current version makes the one before
 * it current again.
 */
export function deleteEmployeeDocument(
  db: Db,
  input: { employeeId: string; documentId: string; actorUserId: string; scope: StoreScope },
) {
  return inTransaction(db, async (tx) => {
    await assertFileInScope(tx, input.employeeId, input.scope);
    const doc = await tx.employeeDocument.findFirst({
      where: { id: input.documentId, employeeId: input.employeeId },
      select: docSelect,
    });
    if (!doc) throw new DomainError('document_not_found', 404);
    const next = await tx.employeeDocument.findUnique({ where: { previousId: doc.id } });
    await tx.employeeDocument.delete({ where: { id: doc.id } });
    if (next)
      await tx.employeeDocument.update({
        where: { id: next.id },
        data: { previousId: doc.previousId },
      });
    else if (doc.isCurrent && doc.previousId)
      await tx.employeeDocument.update({
        where: { id: doc.previousId },
        data: { isCurrent: true },
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.document_delete',
      entityType: 'employee',
      entityId: input.employeeId,
      before: {
        documentId: doc.id,
        type: doc.type.code,
        version: doc.version,
        title: doc.title,
        issuedOn: day(doc.issuedOn),
        expiresOn: day(doc.expiresOn),
      },
    });
    return { deleted: true };
  });
}

// ─── expiry alerts ─────────────────────────────────────────────────────────────

/**
 * Raises one document_expiring alert per current document its type's alert days (else
 * hr.document_alert_days) before it runs out and one document_expired on the day (or the
 * first run after it), also for the national ID date on the file. Each alert has its own key
 * (kind, document and expiry day), so running twice raises nothing twice and a renewed
 * document with a new date is watched again.
 */
export async function checkDocumentExpiry(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const defaultDays = await getSetting(db, 'hr.document_alert_days');
  const types = await db.employeeDocumentType.findMany({
    where: { isActive: true, hasExpiry: true },
  });
  const longest = Math.max(defaultDays, ...types.map((t) => t.alertDays ?? defaultDays));
  const horizon = toDate(addDays(today, longest))!;
  const docs = await db.employeeDocument.findMany({
    where: {
      isCurrent: true,
      status: { not: 'rejected' },
      expiresOn: { lte: horizon },
      employee: { status: { not: 'left' } },
      typeId: { in: types.map((t) => t.id) },
    },
    select: {
      id: true,
      typeId: true,
      title: true,
      expiresOn: true,
      employee: { select: { id: true, nameEn: true, nameAr: true, homeStoreId: true } },
    },
  });
  const ids = await db.employee.findMany({
    where: {
      nationalIdExpiresOn: { lte: toDate(addDays(today, defaultDays))! },
      status: { not: 'left' },
    },
    select: { id: true, nameEn: true, nameAr: true, homeStoreId: true, nationalIdExpiresOn: true },
  });
  const items = [
    ...docs.flatMap((d) => {
      const t = types.find((x) => x.id === d.typeId)!;
      const expiresOn = day(d.expiresOn)!;
      if (expiresOn > addDays(today, t.alertDays ?? defaultDays)) return [];
      return [
        {
          ref: d.id,
          documentId: d.id as string | null,
          kind: t.code,
          typeNameEn: t.nameEn,
          typeNameAr: t.nameAr,
          title: d.title,
          expiresOn,
          employee: d.employee,
        },
      ];
    }),
    ...ids.map((e) => ({
      ref: `nid:${e.id}`,
      documentId: null,
      kind: 'national_id',
      typeNameEn: null as string | null,
      typeNameAr: null as string | null,
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
        typeNameEn: i.typeNameEn,
        typeNameAr: i.typeNameAr,
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

// ─── photo ─────────────────────────────────────────────────────────────────────

/** Puts the person's square photo on the file (HR use, or the person from My HR). */
export async function setEmployeePhoto(
  db: Db,
  input: {
    employeeId: string;
    contentType: string;
    data: Buffer;
    actorUserId: string;
    scope: StoreScope;
  },
) {
  if (!(PHOTO_TYPES as readonly string[]).includes(input.contentType))
    throw new DomainError('photo_type_not_allowed', 400);
  if (input.data.length === 0 || input.data.length > MAX_PHOTO_BYTES)
    throw new DomainError('photo_too_large', 400);
  if (!looksLike(input.contentType, input.data)) throw new DomainError('photo_not_readable', 400);
  return inTransaction(db, async (tx: Tx) => {
    await assertFileInScope(tx, input.employeeId, input.scope);
    const before = await tx.employeePhoto.findUnique({
      where: { employeeId: input.employeeId },
      select: { sizeBytes: true },
    });
    const bytes = new Uint8Array(input.data);
    const photo = await tx.employeePhoto.upsert({
      where: { employeeId: input.employeeId },
      create: {
        employeeId: input.employeeId,
        contentType: input.contentType,
        data: bytes,
        sizeBytes: input.data.length,
      },
      update: { contentType: input.contentType, data: bytes, sizeBytes: input.data.length },
      select: { updatedAt: true },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.photo',
      entityType: 'employee',
      entityId: input.employeeId,
      before: { photo: Boolean(before) },
      after: { photo: true, sizeBytes: input.data.length },
    });
    return { photoVersion: photo.updatedAt.getTime() };
  });
}

export async function getEmployeePhoto(db: Db, employeeId: string) {
  const photo = await db.employeePhoto.findUnique({ where: { employeeId } });
  if (!photo) throw new DomainError('photo_not_found', 404);
  return photo;
}

export function deleteEmployeePhoto(
  db: Db,
  input: { employeeId: string; actorUserId: string; scope: StoreScope },
) {
  return inTransaction(db, async (tx) => {
    await assertFileInScope(tx, input.employeeId, input.scope);
    const done = await tx.employeePhoto.deleteMany({ where: { employeeId: input.employeeId } });
    if (done.count === 0) throw new DomainError('photo_not_found', 404);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.photo',
      entityType: 'employee',
      entityId: input.employeeId,
      before: { photo: true },
      after: { photo: false },
    });
    return { deleted: true };
  });
}

export type { DocType };

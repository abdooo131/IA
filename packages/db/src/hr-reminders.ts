import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  type DocumentState,
  employeeCode,
  REMINDABLE_STATES,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { documentChecklist, documentState } from './hr-documents';
import { getSetting } from './settings';

// HR phase 2 (docs/HR.md "Phase 2 as built"): easier documents. HR reminds a person to send a
// missing or expiring document (a push notification and a notice in My HR, once per document
// type and Cairo day), and sees every document running out in a month on a calendar.

type Tx = Prisma.TransactionClient;
type StoreScope = string[] | null;

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const remindable = (s: DocumentState) => (REMINDABLE_STATES as readonly string[]).includes(s);

async function loadFile(db: Db, employeeId: string, scope: StoreScope) {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, homeStoreId: true, status: true, nameEn: true },
  });
  if (!e) throw new DomainError('employee_not_found', 404);
  if (scope !== null && !(e.homeStoreId && scope.includes(e.homeStoreId)))
    throw new DomainError('store_not_allowed', 403);
  if (e.status === 'left') throw new DomainError('employee_left', 409);
  return e;
}

/** One reminder row a day per type; false when one was already sent today. */
async function remindOnce(
  tx: Tx,
  input: { employeeId: string; typeId: string; typeCode: string; state: DocumentState },
  actorUserId: string,
  today: string,
) {
  const made = await tx.documentReminder.createMany({
    data: [
      {
        employeeId: input.employeeId,
        typeId: input.typeId,
        day: dayDate(today),
        state: input.state,
        createdById: actorUserId,
      },
    ],
    skipDuplicates: true,
  });
  if (made.count === 0) return false;
  await recordAudit(tx, {
    actorUserId,
    action: 'employee.document_remind',
    entityType: 'employee',
    entityId: input.employeeId,
    after: { type: input.typeCode, state: input.state },
  });
  return true;
}

/**
 * HR reminds a person to send one document that is missing, refused, expired or running out
 * (once per type and Cairo day; a second tap the same day sends nothing). HR use.
 */
export async function remindDocument(
  db: Db,
  input: {
    employeeId: string;
    typeId: string;
    actorUserId: string;
    scope: StoreScope;
    confidential: boolean;
    now?: Date;
  },
) {
  const today = cairoDay(input.now ?? new Date());
  await loadFile(db, input.employeeId, input.scope);
  const list = await documentChecklist(db, input.employeeId, {
    confidential: input.confidential,
  });
  const item = list.items.find((i) => i.type.id === input.typeId);
  if (!item) throw new DomainError('document_type_not_found', 404);
  if (!remindable(item.state)) throw new DomainError('document_in_order', 409);
  return inTransaction(db, async (tx) => {
    const sent = await remindOnce(
      tx,
      {
        employeeId: input.employeeId,
        typeId: item.type.id,
        typeCode: item.type.code,
        state: item.state,
      },
      input.actorUserId,
      today,
    );
    return { sent, alreadyToday: !sent };
  });
}

/** Reminds a person of every required document that is not in order (HR use). */
export async function remindAllMissing(
  db: Db,
  input: {
    employeeId: string;
    actorUserId: string;
    scope: StoreScope;
    confidential: boolean;
    now?: Date;
  },
) {
  const today = cairoDay(input.now ?? new Date());
  await loadFile(db, input.employeeId, input.scope);
  const list = await documentChecklist(db, input.employeeId, {
    confidential: input.confidential,
  });
  const due = list.items.filter((i) => i.required && remindable(i.state));
  return inTransaction(db, async (tx) => {
    let sent = 0;
    for (const i of due)
      if (
        await remindOnce(
          tx,
          {
            employeeId: input.employeeId,
            typeId: i.type.id,
            typeCode: i.type.code,
            state: i.state,
          },
          input.actorUserId,
          today,
        )
      )
        sent++;
    return { sent, alreadyToday: due.length - sent, total: due.length };
  });
}

/**
 * What HR asked the person to send in the last 14 days and is still not in order (My HR's
 * notice). The latest reminder of each type.
 */
export async function myDocumentReminders(db: Db, userId: string, now: Date = new Date()) {
  const e = await db.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!e) return [];
  const today = cairoDay(now);
  const rows = await db.documentReminder.findMany({
    where: { employeeId: e.id, day: { gte: dayDate(addDays(today, -14)) } },
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  if (rows.length === 0) return [];
  const list = await documentChecklist(db, e.id, { confidential: true });
  const seen = new Set<string>();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.typeId)) continue;
    seen.add(r.typeId);
    const item = list.items.find((i) => i.type.id === r.typeId);
    if (!item || !remindable(item.state)) continue;
    out.push({
      id: r.id,
      day: dayText(r.day),
      by: r.createdBy.name,
      state: item.state,
      type: {
        id: item.type.id,
        nameEn: item.type.nameEn,
        nameAr: item.type.nameAr,
        selfUpload: item.type.selfUpload && !item.type.confidential,
      },
    });
  }
  return out;
}

/**
 * The expiry calendar: every current document that runs out in a month (YYYY-MM), with its
 * person and state, in the person's stores; confidential types only with HR use.
 */
export async function documentsExpiring(
  db: Db,
  input: { month: string; scope: StoreScope; confidential: boolean; now?: Date },
) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new DomainError('validation_failed', 400);
  const from = `${input.month}-01`;
  const [y, m] = input.month.split('-').map(Number) as [number, number];
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = cairoDay(input.now ?? new Date());
  const defaultDays = await getSetting(db, 'hr.document_alert_days');
  const docs = await db.employeeDocument.findMany({
    where: {
      isCurrent: true,
      expiresOn: { gte: dayDate(from), lte: dayDate(to) },
      employee: {
        status: { not: 'left' },
        ...(input.scope && { homeStoreId: { in: input.scope } }),
      },
      type: input.confidential ? undefined : { confidential: false },
    },
    select: {
      id: true,
      status: true,
      expiresOn: true,
      type: { select: { id: true, nameEn: true, nameAr: true, alertDays: true } },
      employee: { select: { id: true, number: true, nameEn: true, nameAr: true } },
    },
    orderBy: [{ expiresOn: 'asc' }],
  });
  return {
    month: input.month,
    from,
    to,
    today,
    items: docs.map((d) => ({
      id: d.id,
      day: dayText(d.expiresOn)!,
      state: documentState(d, today, d.type.alertDays ?? defaultDays),
      type: { id: d.type.id, nameEn: d.type.nameEn, nameAr: d.type.nameAr },
      employee: { ...d.employee, code: employeeCode(d.employee.number) },
    })),
  };
}

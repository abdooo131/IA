import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  type ChecklistKind,
  type ChecklistTaskBody,
  type ChecklistTemplateBody,
  type ChecklistTemplateUpdateBody,
  type StartChecklistBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';

// HR v2 (docs/HR.md): onboarding and offboarding checklists. Templates per position (or one
// default per kind) hold tasks with an owner and a due day; a checklist is copied from a
// template when a person is hired or leaves, so later template edits never change it. A task
// tied to a document type is done by itself once a verified document of that type is on file.

type Tx = Prisma.TransactionClient;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (d: string) => new Date(`${d}T00:00:00Z`);

const templateInclude = {
  position: { select: { id: true, code: true, titleEn: true, titleAr: true } },
  tasks: { orderBy: { sort: 'asc' } },
} as const;

export async function listChecklistTemplates(db: Db) {
  return db.checklistTemplate.findMany({
    include: templateInclude,
    orderBy: [{ kind: 'asc' }, { code: 'asc' }],
  });
}

async function checkTemplateRefs(
  tx: Tx,
  body: Pick<ChecklistTemplateUpdateBody, 'positionId' | 'tasks'>,
) {
  if (body.positionId && !(await tx.jobPosition.findUnique({ where: { id: body.positionId } })))
    throw new DomainError('position_not_found', 404);
  for (const t of body.tasks ?? [])
    if (
      t.documentTypeId &&
      !(await tx.employeeDocumentType.findUnique({ where: { id: t.documentTypeId } }))
    )
      throw new DomainError('document_type_not_found', 404);
}

const taskRows = (tasks: ChecklistTemplateBody['tasks']) =>
  tasks.map((t, i) => ({
    titleEn: t.titleEn,
    titleAr: t.titleAr,
    ownerRole: t.ownerRole,
    dueDays: t.dueDays,
    documentTypeId: t.documentTypeId ?? null,
    sort: i,
  }));

export function createChecklistTemplate(
  db: Db,
  input: { body: ChecklistTemplateBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    if (await tx.checklistTemplate.findUnique({ where: { code: input.body.code } }))
      throw new DomainError('code_taken', 409);
    await checkTemplateRefs(tx, input.body);
    const t = await tx.checklistTemplate.create({
      data: {
        code: input.body.code,
        kind: input.body.kind,
        nameEn: input.body.nameEn,
        nameAr: input.body.nameAr,
        positionId: input.body.positionId ?? null,
        isActive: input.body.isActive ?? true,
        tasks: { create: taskRows(input.body.tasks) },
      },
      include: templateInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'checklist_template.create',
      entityType: 'checklist_template',
      entityId: t.id,
      after: { code: t.code, kind: t.kind, positionId: t.positionId, tasks: t.tasks.length },
    });
    return t;
  });
}

export function updateChecklistTemplate(
  db: Db,
  input: { id: string; body: ChecklistTemplateUpdateBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.checklistTemplate.findUnique({
      where: { id: input.id },
      include: templateInclude,
    });
    if (!before) throw new DomainError('checklist_template_not_found', 404);
    await checkTemplateRefs(tx, input.body);
    if (input.body.tasks)
      await tx.checklistTemplateTask.deleteMany({ where: { templateId: before.id } });
    const after = await tx.checklistTemplate.update({
      where: { id: before.id },
      data: {
        kind: input.body.kind,
        nameEn: input.body.nameEn,
        nameAr: input.body.nameAr,
        positionId: input.body.positionId,
        isActive: input.body.isActive,
        ...(input.body.tasks && { tasks: { create: taskRows(input.body.tasks) } }),
      },
      include: templateInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'checklist_template.update',
      entityType: 'checklist_template',
      entityId: before.id,
      before: {
        nameEn: before.nameEn,
        positionId: before.positionId,
        isActive: before.isActive,
        tasks: before.tasks.map((t) => t.titleEn),
      },
      after: {
        nameEn: after.nameEn,
        positionId: after.positionId,
        isActive: after.isActive,
        tasks: after.tasks.map((t) => t.titleEn),
      },
    });
    return after;
  });
}

/** The template for a person: their position's, else the default of the kind. */
async function templateFor(tx: Tx, kind: ChecklistKind, positionId: string | null) {
  const own = positionId
    ? await tx.checklistTemplate.findFirst({
        where: { kind, positionId, isActive: true },
        include: templateInclude,
        orderBy: { createdAt: 'asc' },
      })
    : null;
  return (
    own ??
    tx.checklistTemplate.findFirst({
      where: { kind, positionId: null, isActive: true },
      include: templateInclude,
      orderBy: { createdAt: 'asc' },
    })
  );
}

/**
 * Starts a checklist for a person from a template (theirs or the one named). Only one open
 * checklist of a kind at a time. Returns null when there is no template to start from.
 */
export async function startChecklist(
  tx: Tx,
  input: { employeeId: string; body: StartChecklistBody; actorUserId: string },
) {
  const e = await tx.employee.findUnique({ where: { id: input.employeeId } });
  if (!e) throw new DomainError('employee_not_found', 404);
  const open = await tx.employeeChecklist.findFirst({
    where: { employeeId: e.id, kind: input.body.kind, status: 'open' },
  });
  if (open) throw new DomainError('checklist_open', 409);
  const template = input.body.templateId
    ? await tx.checklistTemplate.findUnique({
        where: { id: input.body.templateId },
        include: templateInclude,
      })
    : await templateFor(tx, input.body.kind, e.positionId);
  if (input.body.templateId && (!template || template.kind !== input.body.kind))
    throw new DomainError('checklist_template_not_found', 404);
  if (!template) return null;
  const startsOn =
    input.body.startsOn ??
    (input.body.kind === 'onboarding' ? day(e.hireDate) : day(e.leftOn)) ??
    cairoDay(new Date());
  const checklist = await tx.employeeChecklist.create({
    data: {
      employeeId: e.id,
      templateId: template.id,
      kind: template.kind,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      startsOn: toDate(startsOn),
      createdById: input.actorUserId,
      tasks: {
        create: template.tasks.map((t) => ({
          titleEn: t.titleEn,
          titleAr: t.titleAr,
          ownerRole: t.ownerRole,
          dueOn: toDate(addDays(startsOn, t.dueDays)),
          documentTypeId: t.documentTypeId,
          sort: t.sort,
        })),
      },
    },
  });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'employee.checklist_start',
    entityType: 'employee',
    entityId: e.id,
    after: {
      checklistId: checklist.id,
      kind: checklist.kind,
      template: template.code,
      startsOn,
      tasks: template.tasks.length,
    },
  });
  // Documents already verified on the file tick their tasks at once.
  const verified = await tx.employeeDocument.findMany({
    where: { employeeId: e.id, isCurrent: true, status: 'verified' },
    select: { typeId: true },
  });
  for (const typeId of new Set(verified.map((d) => d.typeId)))
    await completeDocumentTasks(tx, e.id, typeId, input.actorUserId);
  return checklist;
}

export function startChecklistFor(
  db: Db,
  input: { employeeId: string; body: StartChecklistBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const c = await startChecklist(tx, input);
    if (!c) throw new DomainError('checklist_template_not_found', 404);
    return c;
  });
}

/** Closes a checklist when its last task is done (or opens it again when one is undone). */
async function settleChecklist(tx: Tx, checklistId: string) {
  const left = await tx.employeeChecklistTask.count({ where: { checklistId, doneAt: null } });
  const c = await tx.employeeChecklist.findUnique({ where: { id: checklistId } });
  if (!c || c.status === 'cancelled') return;
  const status = left === 0 ? 'done' : 'open';
  if (c.status !== status)
    await tx.employeeChecklist.update({ where: { id: checklistId }, data: { status } });
}

/** Ticks the open tasks waiting for a document type once a verified one is on the file. */
export async function completeDocumentTasks(
  tx: Tx,
  employeeId: string,
  typeId: string,
  actorUserId: string,
) {
  const tasks = await tx.employeeChecklistTask.findMany({
    where: {
      documentTypeId: typeId,
      doneAt: null,
      checklist: { employeeId, status: 'open' },
    },
  });
  for (const t of tasks) {
    await tx.employeeChecklistTask.update({
      where: { id: t.id },
      data: { doneAt: new Date(), doneById: actorUserId, note: 'document_verified' },
    });
    await settleChecklist(tx, t.checklistId);
  }
}

/** HR ticks or unticks a task (with an optional note). */
export function setChecklistTask(
  db: Db,
  input: { employeeId: string; taskId: string; body: ChecklistTaskBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const task = await tx.employeeChecklistTask.findUnique({
      where: { id: input.taskId },
      include: { checklist: true },
    });
    if (!task || task.checklist.employeeId !== input.employeeId)
      throw new DomainError('task_not_found', 404);
    if (task.checklist.status === 'cancelled') throw new DomainError('checklist_cancelled', 409);
    const after = await tx.employeeChecklistTask.update({
      where: { id: task.id },
      data: {
        doneAt: input.body.done ? (task.doneAt ?? new Date()) : null,
        doneById: input.body.done ? (task.doneById ?? input.actorUserId) : null,
        note: input.body.note === undefined ? task.note : input.body.note || null,
      },
    });
    await settleChecklist(tx, task.checklistId);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.checklist_task',
      entityType: 'employee',
      entityId: input.employeeId,
      before: { taskId: task.id, title: task.titleEn, done: Boolean(task.doneAt) },
      after: {
        taskId: task.id,
        title: task.titleEn,
        done: Boolean(after.doneAt),
        note: after.note,
      },
    });
    return after;
  });
}

export function cancelChecklist(
  db: Db,
  input: { employeeId: string; checklistId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const c = await tx.employeeChecklist.findFirst({
      where: { id: input.checklistId, employeeId: input.employeeId },
    });
    if (!c) throw new DomainError('checklist_not_found', 404);
    if (c.status !== 'open') throw new DomainError('checklist_not_open', 409);
    await tx.employeeChecklist.update({ where: { id: c.id }, data: { status: 'cancelled' } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.checklist_cancel',
      entityType: 'employee',
      entityId: input.employeeId,
      before: { checklistId: c.id, status: c.status },
      after: { checklistId: c.id, status: 'cancelled' },
    });
    return { cancelled: true };
  });
}

/** A person's checklists with their tasks, newest first; overdue tasks are flagged. */
export async function employeeChecklists(db: Db, employeeId: string) {
  const today = cairoDay(new Date());
  const rows = await db.employeeChecklist.findMany({
    where: { employeeId },
    include: {
      tasks: { orderBy: [{ sort: 'asc' }], include: { doneBy: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((c) => ({
    id: c.id,
    kind: c.kind,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
    startsOn: day(c.startsOn),
    status: c.status,
    done: c.tasks.filter((t) => t.doneAt).length,
    total: c.tasks.length,
    tasks: c.tasks.map((t) => ({
      id: t.id,
      titleEn: t.titleEn,
      titleAr: t.titleAr,
      ownerRole: t.ownerRole,
      dueOn: day(t.dueOn),
      documentTypeId: t.documentTypeId,
      doneAt: t.doneAt,
      doneBy: t.doneBy?.name ?? null,
      note: t.note,
      overdue: !t.doneAt && c.status === 'open' && day(t.dueOn)! < today,
    })),
  }));
}

/** Open checklists across the company with what is late (the HR home shows them). */
export async function openChecklists(db: Db) {
  const today = cairoDay(new Date());
  const rows = await db.employeeChecklist.findMany({
    where: { status: 'open', employee: { status: { not: 'left' } } },
    include: {
      employee: { select: { id: true, number: true, nameEn: true, nameAr: true } },
      tasks: { select: { doneAt: true, dueOn: true } },
    },
    orderBy: { startsOn: 'asc' },
    take: 200,
  });
  return rows.map((c) => ({
    id: c.id,
    kind: c.kind,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
    startsOn: day(c.startsOn),
    employee: c.employee,
    done: c.tasks.filter((t) => t.doneAt).length,
    total: c.tasks.length,
    overdue: c.tasks.filter((t) => !t.doneAt && day(t.dueOn)! < today).length,
  }));
}

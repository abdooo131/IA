import type { PenaltyKind, Prisma, ViolationStatus } from '@prisma/client';
import {
  addDays,
  appealOpen,
  cairoDay,
  cairoDayStart,
  employeeCode,
  ladderStep,
  type RecordViolationBody,
  SUGGESTION_TYPE_CODES,
  type SuggestionKind,
  violationNumber,
  type ViolationTypeBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { looksLike } from './hr-documents';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { inStoreScope, type StoreScope } from './hr-leave';
import { getSetting } from './settings';

// HR phase 3 (docs/HR.md "Phase 3 as built"): violation types with an escalation ladder,
// violations recorded by HR on the next step of the person's ladder (prior violations of the type
// inside hr.violation_period_days), one appeal by the person within hr.appeal_days, decided by HR
// manage (never the one who recorded it), final after the window; final deductions reach the
// salary run once (outsourced people: only listed for their company). The attendance close
// suggests violations (late past the grace, absent without leave) that HR confirms or dismisses.

type Tx = Prisma.TransactionClient;

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));
const MAX_EVIDENCE_BYTES = 3_000_000;
const EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const LIVE: ViolationStatus[] = ['recorded', 'appealed', 'final'];

// ─── types and ladders ─────────────────────────────────────────────────────────

const typeInclude = { steps: { orderBy: { step: 'asc' } } } as const;
type TypeRow = Prisma.ViolationTypeGetPayload<{ include: typeof typeInclude }>;

function stepView(s: TypeRow['steps'][number]) {
  return {
    step: s.step,
    penalty: s.penalty,
    days: num(s.days),
    amountPiastres: s.amountPiastres,
  };
}

function typeView(t: TypeRow) {
  return {
    id: t.id,
    code: t.code,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    category: t.category,
    isActive: t.isActive,
    sort: t.sort,
    steps: t.steps.map(stepView),
  };
}
export type ViolationTypeView = ReturnType<typeof typeView>;

export async function listViolationTypes(db: Db, options: { activeOnly?: boolean } = {}) {
  const rows = await db.violationType.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    include: typeInclude,
    orderBy: [{ isActive: 'desc' }, { sort: 'asc' }, { nameEn: 'asc' }],
  });
  return rows.map(typeView);
}

function stepsData(body: ViolationTypeBody) {
  return body.steps.map((s, i) => ({
    step: i + 1,
    penalty: s.penalty,
    days: s.days ?? null,
    amountPiastres: s.amountPiastres ?? null,
  }));
}

export function createViolationType(
  db: Db,
  input: { body: ViolationTypeBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    if (await tx.violationType.findUnique({ where: { code: input.body.code } }))
      throw new DomainError('code_taken');
    const t = await tx.violationType.create({
      data: {
        code: input.body.code,
        nameEn: input.body.nameEn,
        nameAr: input.body.nameAr,
        category: input.body.category,
        isActive: input.body.isActive,
        sort: input.body.sort ?? 0,
        steps: { create: stepsData(input.body) },
      },
      include: typeInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'violation_type.create',
      entityType: 'violation_type',
      entityId: t.id,
      after: typeView(t),
    });
    return typeView(t);
  });
}

/** Changes a type and its ladder. Violations already recorded keep the penalty they got. */
export function updateViolationType(
  db: Db,
  input: { typeId: string; body: ViolationTypeBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.violationType.findUnique({
      where: { id: input.typeId },
      include: typeInclude,
    });
    if (!before) throw new DomainError('violation_type_not_found', 404);
    const clash = await tx.violationType.findUnique({ where: { code: input.body.code } });
    if (clash && clash.id !== before.id) throw new DomainError('code_taken');
    await tx.violationStep.deleteMany({ where: { typeId: before.id } });
    const t = await tx.violationType.update({
      where: { id: before.id },
      data: {
        code: input.body.code,
        nameEn: input.body.nameEn,
        nameAr: input.body.nameAr,
        category: input.body.category,
        isActive: input.body.isActive,
        ...(input.body.sort !== undefined && { sort: input.body.sort }),
        steps: { create: stepsData(input.body) },
      },
      include: typeInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'violation_type.update',
      entityType: 'violation_type',
      entityId: t.id,
      before: typeView(before),
      after: typeView(t),
    });
    return typeView(t);
  });
}

// ─── recording ─────────────────────────────────────────────────────────────────

/**
 * The ladder step a new violation of a type gets: one past the person's violations of that type
 * (not cancelled) dated inside hr.violation_period_days up to its day, at most the last step.
 */
export async function nextViolationStep(
  db: Db,
  input: { employeeId: string; typeId: string; occurredOn: string },
) {
  const type = await db.violationType.findUnique({
    where: { id: input.typeId },
    include: typeInclude,
  });
  if (!type) throw new DomainError('violation_type_not_found', 404);
  const period = await getSetting(db, 'hr.violation_period_days');
  const prior = await db.violation.count({
    where: {
      employeeId: input.employeeId,
      typeId: type.id,
      status: { in: LIVE },
      occurredOn: {
        gt: dayDate(addDays(input.occurredOn, -period)),
        lte: dayDate(input.occurredOn),
      },
    },
  });
  const step = ladderStep(prior, type.steps.length);
  return { step, prior, periodDays: period, penalty: stepView(type.steps[step - 1]!) };
}

const violationInclude = {
  type: { select: { id: true, code: true, nameEn: true, nameAr: true, category: true } },
  employee: {
    select: {
      id: true,
      number: true,
      nameEn: true,
      nameAr: true,
      userId: true,
      homeStoreId: true,
      employment: true,
      staffingSupplier: { select: { id: true, name: true } },
      homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
  },
} as const;
type ViolationRow = Prisma.ViolationGetPayload<{ include: typeof violationInclude }>;

function violationView(v: ViolationRow, appealDays: number, now: Date) {
  return {
    id: v.id,
    number: violationNumber(v.number),
    employee: {
      id: v.employee.id,
      code: employeeCode(v.employee.number),
      nameEn: v.employee.nameEn,
      nameAr: v.employee.nameAr,
      employment: v.employee.employment,
      staffingSupplier: v.employee.staffingSupplier,
      store: v.employee.homeStore,
    },
    type: v.type,
    occurredOn: dayText(v.occurredOn),
    description: v.description,
    suggestedStep: v.suggestedStep,
    step: v.step,
    stepReason: v.stepReason,
    penalty: v.penalty,
    days: num(v.days),
    amountPiastres: v.amountPiastres,
    status: v.status,
    recordedAt: v.recordedAt,
    recordedById: v.recordedById,
    appealUntil: new Date(v.recordedAt.getTime() + appealDays * 86_400_000),
    canAppeal:
      v.status === 'recorded' && !v.appealedAt && appealOpen(v.recordedAt, now, appealDays),
    appealReason: v.appealReason,
    appealedAt: v.appealedAt,
    decision: v.decision,
    decisionNote: v.decisionNote,
    decidedAt: v.decidedAt,
    finalAt: v.finalAt,
    hasEvidence: !!v.evidenceContentType,
    inPayroll: !!v.payrollEntryId,
    deductionPiastres: v.deductionPiastres,
    /** An outsourced person's deduction is only told to their company */
    forSupplier:
      v.employee.employment === 'outsourced' &&
      (v.penalty === 'deduction_days' || v.penalty === 'deduction_amount'),
  };
}
export type ViolationView = ReturnType<typeof violationView>;

async function recordTx(
  tx: Tx,
  input: {
    body: RecordViolationBody;
    actorUserId: string;
    scope: StoreScope;
    now: Date;
  },
) {
  const body = input.body;
  const seen = await tx.violation.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
    include: violationInclude,
  });
  if (seen) {
    if (seen.employeeId !== body.employeeId) throw new DomainError('idempotency_key_reused');
    return seen;
  }
  await tx.$queryRaw`SELECT id FROM employees WHERE id = ${body.employeeId} FOR UPDATE`;
  const e = await tx.employee.findUnique({ where: { id: body.employeeId } });
  if (!e) throw new DomainError('employee_not_found', 404);
  if (!inStoreScope(input.scope, e.homeStoreId)) throw new DomainError('store_not_allowed', 403);
  if (e.userId === input.actorUserId) throw new DomainError('own_violation', 403);
  if (e.status === 'left') throw new DomainError('employee_left', 409);
  if (body.occurredOn > cairoDay(input.now)) throw new DomainError('day_in_future', 400);
  const type = await tx.violationType.findUnique({
    where: { id: body.typeId },
    include: typeInclude,
  });
  if (!type || !type.isActive) throw new DomainError('violation_type_not_found', 404);
  const next = await nextViolationStep(tx, {
    employeeId: e.id,
    typeId: type.id,
    occurredOn: body.occurredOn,
  });
  const step = body.step ?? next.step;
  const row = type.steps[step - 1];
  if (!row) throw new DomainError('invalid_step', 400);
  let amount: number | null = null;
  if (row.penalty === 'deduction_amount') {
    amount = row.amountPiastres ?? body.amountPiastres ?? null;
    if (!amount) throw new DomainError('amount_required', 400);
  }
  const v = await tx.violation.create({
    data: {
      employeeId: e.id,
      typeId: type.id,
      occurredOn: dayDate(body.occurredOn),
      description: body.description,
      suggestedStep: next.step,
      step,
      stepReason: step !== next.step ? (body.stepReason ?? null) : null,
      penalty: row.penalty,
      days: row.days,
      amountPiastres: amount,
      recordedById: input.actorUserId,
      recordedAt: input.now,
      idempotencyKey: body.idempotencyKey,
    },
    include: violationInclude,
  });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'violation.record',
    entityType: 'violation',
    entityId: v.id,
    after: {
      employeeId: e.id,
      type: type.code,
      occurredOn: body.occurredOn,
      step,
      suggestedStep: next.step,
      stepReason: v.stepReason,
      penalty: row.penalty,
      days: num(row.days),
      amountPiastres: amount,
    },
  });
  if (row.penalty === 'termination_review')
    await tx.alert.createMany({
      data: [
        {
          type: 'hr_termination_review',
          key: `termination_review:${v.id}`,
          darkStoreId: e.homeStoreId,
          data: {
            violationId: v.id,
            number: violationNumber(v.number),
            employeeId: e.id,
            nameEn: e.nameEn,
            nameAr: e.nameAr ?? e.nameEn,
            type: type.nameEn,
            typeAr: type.nameAr,
          },
        },
      ],
      skipDuplicates: true,
    });
  return v;
}

/** HR (hr use) records a violation on the next step of the person's ladder. */
export function recordViolation(
  db: Db,
  input: { body: RecordViolationBody; actorUserId: string; scope: StoreScope; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const v = await recordTx(tx, { ...input, now });
    return violationView(v, await getSetting(tx, 'hr.appeal_days'), now);
  });
}

/** A photo or document backing a violation (HR use). */
export function attachViolationEvidence(
  db: Db,
  input: {
    violationId: string;
    actorUserId: string;
    scope: StoreScope;
    contentType: string;
    data: Buffer;
    name?: string | null;
  },
) {
  return inTransaction(db, async (tx) => {
    const v = await tx.violation.findUnique({
      where: { id: input.violationId },
      include: violationInclude,
    });
    if (!v) throw new DomainError('violation_not_found', 404);
    if (!inStoreScope(input.scope, v.employee.homeStoreId))
      throw new DomainError('store_not_allowed', 403);
    if (v.status === 'cancelled') throw new DomainError('violation_closed');
    if (!EVIDENCE_TYPES.includes(input.contentType) || !looksLike(input.contentType, input.data))
      throw new DomainError('document_type_not_allowed', 400);
    if (input.data.length === 0 || input.data.length > MAX_EVIDENCE_BYTES)
      throw new DomainError('document_too_large', 400);
    await tx.violation.update({
      where: { id: v.id },
      data: {
        evidenceContentType: input.contentType,
        evidenceData: new Uint8Array(input.data),
        evidenceName: input.name?.slice(0, 200) ?? null,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'violation.evidence',
      entityType: 'violation',
      entityId: v.id,
      after: { contentType: input.contentType, bytes: input.data.length },
    });
    return { attached: true };
  });
}

export async function violationEvidence(db: Db, violationId: string) {
  const v = await db.violation.findUnique({
    where: { id: violationId },
    select: {
      evidenceContentType: true,
      evidenceData: true,
      evidenceName: true,
      employee: { select: { userId: true, homeStoreId: true } },
    },
  });
  if (!v || !v.evidenceContentType || !v.evidenceData)
    throw new DomainError('document_not_found', 404);
  return v;
}

/** The person appeals once, with a reason, within hr.appeal_days of the recording. */
export function appealViolation(
  db: Db,
  input: { violationId: string; actorUserId: string; reason: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    await tx.$queryRaw`SELECT id FROM violations WHERE id = ${input.violationId} FOR UPDATE`;
    const v = await tx.violation.findUnique({
      where: { id: input.violationId },
      include: violationInclude,
    });
    if (!v || v.employee.userId !== input.actorUserId)
      throw new DomainError('violation_not_found', 404);
    if (v.appealedAt) throw new DomainError('already_appealed');
    const appealDays = await getSetting(tx, 'hr.appeal_days');
    if (v.status !== 'recorded' || !appealOpen(v.recordedAt, now, appealDays))
      throw new DomainError('appeal_closed');
    const after = await tx.violation.update({
      where: { id: v.id },
      data: { status: 'appealed', appealReason: input.reason, appealedAt: now },
      include: violationInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'violation.appeal',
      entityType: 'violation',
      entityId: v.id,
      before: { status: v.status },
      after: { status: 'appealed', reason: input.reason },
    });
    return violationView(after, appealDays, now);
  });
}

/**
 * HR manage upholds (final at once) or cancels a recorded or appealed violation, with a note.
 * Never the person who recorded it, never one's own.
 */
export function decideViolation(
  db: Db,
  input: {
    violationId: string;
    actorUserId: string;
    decision: 'upheld' | 'cancelled';
    note: string;
    scope: StoreScope;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    await tx.$queryRaw`SELECT id FROM violations WHERE id = ${input.violationId} FOR UPDATE`;
    const v = await tx.violation.findUnique({
      where: { id: input.violationId },
      include: violationInclude,
    });
    if (!v) throw new DomainError('violation_not_found', 404);
    if (!inStoreScope(input.scope, v.employee.homeStoreId))
      throw new DomainError('store_not_allowed', 403);
    if (v.recordedById === input.actorUserId) throw new DomainError('same_person', 403);
    if (v.employee.userId === input.actorUserId) throw new DomainError('own_violation', 403);
    if (v.status !== 'recorded' && v.status !== 'appealed')
      throw new DomainError('violation_closed');
    const upheld = input.decision === 'upheld';
    const after = await tx.violation.update({
      where: { id: v.id },
      data: {
        status: upheld ? 'final' : 'cancelled',
        decision: input.decision,
        decisionNote: input.note,
        decidedById: input.actorUserId,
        decidedAt: now,
        ...(upheld && { finalAt: now }),
      },
      include: violationInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: upheld ? 'violation.uphold' : 'violation.cancel',
      entityType: 'violation',
      entityId: v.id,
      before: { status: v.status },
      after: { status: after.status, note: input.note },
    });
    return violationView(after, await getSetting(tx, 'hr.appeal_days'), now);
  });
}

/**
 * Violations without an appeal become final once hr.appeal_days have passed (run by the API's
 * jobs; each row moves once, so running twice changes nothing).
 */
export async function finalizeViolations(db: Db, now: Date = new Date()) {
  const appealDays = await getSetting(db, 'hr.appeal_days');
  const due = await db.violation.findMany({
    where: {
      status: 'recorded',
      recordedAt: { lte: new Date(now.getTime() - appealDays * 86_400_000) },
    },
    select: { id: true },
    take: 500,
  });
  let finalized = 0;
  for (const v of due)
    await inTransaction(db, async (tx) => {
      const done = await tx.violation.updateMany({
        where: { id: v.id, status: 'recorded' },
        data: { status: 'final', finalAt: now },
      });
      if (done.count !== 1) return;
      finalized++;
      await recordAudit(tx, {
        actorUserId: null,
        action: 'violation.final',
        entityType: 'violation',
        entityId: v.id,
        before: { status: 'recorded' },
        after: { status: 'final', reason: 'appeal_window_over' },
      });
    });
  return { finalized };
}

// ─── lists ─────────────────────────────────────────────────────────────────────

export interface ViolationFilter {
  scope: StoreScope;
  status?: string;
  employeeId?: string;
  typeId?: string;
  employment?: 'employee' | 'outsourced';
  /** Final deductions of outsourced people to tell their company */
  forSupplier?: boolean;
}

export async function listViolations(db: Db, f: ViolationFilter, now: Date = new Date()) {
  const deductions: PenaltyKind[] = ['deduction_days', 'deduction_amount'];
  const rows = await db.violation.findMany({
    where: {
      ...(f.status &&
        ['recorded', 'appealed', 'final', 'cancelled'].includes(f.status) && {
          status: f.status as ViolationStatus,
        }),
      ...(f.typeId && { typeId: f.typeId }),
      ...(f.employeeId && { employeeId: f.employeeId }),
      ...(f.forSupplier && { penalty: { in: deductions }, status: 'final' }),
      employee: {
        ...(f.scope && { homeStoreId: { in: f.scope } }),
        ...(f.employment && { employment: f.employment }),
        ...(f.forSupplier && { employment: 'outsourced' }),
      },
    },
    include: violationInclude,
    orderBy: [{ occurredOn: 'desc' }, { number: 'desc' }],
    take: 500,
  });
  const appealDays = await getSetting(db, 'hr.appeal_days');
  return rows.map((v) => violationView(v, appealDays, now));
}

export async function violationDetail(
  db: Db,
  input: { violationId: string; scope: StoreScope | 'self'; viewerUserId?: string; now?: Date },
) {
  const v = await db.violation.findUnique({
    where: { id: input.violationId },
    include: violationInclude,
  });
  if (!v) throw new DomainError('violation_not_found', 404);
  if (input.scope === 'self') {
    if (v.employee.userId !== input.viewerUserId) throw new DomainError('violation_not_found', 404);
  } else if (!inStoreScope(input.scope, v.employee.homeStoreId))
    throw new DomainError('store_not_allowed', 403);
  const ids = [v.recordedById, v.decidedById].filter((x): x is string => !!x);
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const ladder = await db.violation.findMany({
    where: {
      employeeId: v.employeeId,
      typeId: v.typeId,
      status: { in: LIVE },
      id: { not: v.id },
    },
    select: { id: true, number: true, occurredOn: true, step: true, status: true },
    orderBy: { occurredOn: 'desc' },
    take: 20,
  });
  return {
    ...violationView(v, await getSetting(db, 'hr.appeal_days'), input.now ?? new Date()),
    recordedBy: name(v.recordedById),
    decidedBy: name(v.decidedById),
    others: ladder.map((o) => ({
      id: o.id,
      number: violationNumber(o.number),
      occurredOn: dayText(o.occurredOn),
      step: o.step,
      status: o.status,
    })),
  };
}
export type ViolationDetail = Awaited<ReturnType<typeof violationDetail>>;

/** My HR: my violations, with whether I may still appeal each one. */
export async function myViolations(db: Db, input: { userId: string; now?: Date }) {
  const e = await db.employee.findUnique({ where: { userId: input.userId }, select: { id: true } });
  if (!e) throw new DomainError('employee_not_found', 404);
  return {
    appealDays: await getSetting(db, 'hr.appeal_days'),
    violations: await listViolations(db, { scope: null, employeeId: e.id }, input.now),
  };
}

// ─── suggestions from attendance ───────────────────────────────────────────────

/**
 * Looks at the closed attendance days of the last `lookbackDays` and suggests one violation per
 * person and day: late past hr.late_grace_minutes, or absent (approved leave makes the day on
 * leave, never absent). Suggestions whose day was corrected since are dismissed. Safe to run
 * twice: one row per person and day.
 */
export async function suggestViolations(db: Db, now: Date = new Date(), lookbackDays = 14) {
  const today = cairoDay(now);
  const grace = await getSetting(db, 'hr.late_grace_minutes');
  const from = dayDate(addDays(today, -lookbackDays));
  const days = await db.attendanceDay.findMany({
    where: {
      day: { gte: from, lte: dayDate(today) },
      OR: [{ status: 'absent' }, { status: 'late', lateMinutes: { gt: grace } }],
      employee: { status: { not: 'left' } },
    },
    select: { employeeId: true, day: true, status: true, lateMinutes: true },
  });
  const types = await db.violationType.findMany({
    where: { code: { in: Object.values(SUGGESTION_TYPE_CODES) }, isActive: true },
    select: { id: true, code: true },
  });
  const typeOf = (kind: SuggestionKind) =>
    types.find((t) => t.code === SUGGESTION_TYPE_CODES[kind])?.id ?? null;
  const rows = days.map((d) => {
    const kind: SuggestionKind = d.status === 'absent' ? 'absent' : 'late';
    return {
      employeeId: d.employeeId,
      day: d.day,
      kind,
      lateMinutes: kind === 'late' ? d.lateMinutes : 0,
      typeId: typeOf(kind),
    };
  });
  const created = rows.length
    ? await db.violationSuggestion.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 };
  // A day corrected since (now present, on leave...) no longer suggests anything.
  const open = await db.violationSuggestion.findMany({
    where: { status: 'open', day: { gte: from } },
    select: { id: true, employeeId: true, day: true },
  });
  const still = new Set(days.map((d) => `${d.employeeId}|${dayText(d.day)}`));
  const stale = open.filter((s) => !still.has(`${s.employeeId}|${dayText(s.day)}`));
  if (stale.length)
    await db.violationSuggestion.updateMany({
      where: { id: { in: stale.map((s) => s.id) }, status: 'open' },
      data: { status: 'dismissed', decidedAt: now },
    });
  return { suggested: created.count, dismissed: stale.length };
}

export async function listSuggestions(db: Db, input: { scope: StoreScope; status?: string }) {
  const rows = await db.violationSuggestion.findMany({
    where: {
      status: input.status ?? 'open',
      ...(input.scope && { employee: { homeStoreId: { in: input.scope } } }),
    },
    include: {
      type: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      employee: {
        select: {
          id: true,
          number: true,
          nameEn: true,
          nameAr: true,
          employment: true,
          homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        },
      },
      violation: { select: { id: true, number: true } },
    },
    orderBy: [{ day: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  });
  return rows.map((s) => ({
    id: s.id,
    day: dayText(s.day),
    kind: s.kind as SuggestionKind,
    lateMinutes: s.lateMinutes,
    status: s.status,
    type: s.type,
    employee: {
      id: s.employee.id,
      code: employeeCode(s.employee.number),
      nameEn: s.employee.nameEn,
      nameAr: s.employee.nameAr,
      employment: s.employee.employment,
      store: s.employee.homeStore,
    },
    violation: s.violation
      ? { id: s.violation.id, number: violationNumber(s.violation.number) }
      : null,
  }));
}

/** HR confirms a suggestion: it is recorded on the person's ladder like any violation. */
export function confirmSuggestion(
  db: Db,
  input: {
    suggestionId: string;
    actorUserId: string;
    scope: StoreScope;
    typeId?: string;
    description?: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    await tx.$queryRaw`SELECT id FROM violation_suggestions WHERE id = ${input.suggestionId} FOR UPDATE`;
    const s = await tx.violationSuggestion.findUnique({ where: { id: input.suggestionId } });
    if (!s) throw new DomainError('suggestion_not_found', 404);
    if (s.status !== 'open') throw new DomainError('suggestion_closed');
    const typeId = input.typeId ?? s.typeId;
    if (!typeId) throw new DomainError('violation_type_not_found', 404);
    const day = dayText(s.day);
    const description =
      input.description ??
      (s.kind === 'late'
        ? `Late ${s.lateMinutes} min on ${day}`
        : `Absent without leave on ${day}`);
    const v = await recordTx(tx, {
      body: {
        employeeId: s.employeeId,
        typeId,
        occurredOn: day,
        description,
        idempotencyKey: input.idempotencyKey,
      },
      actorUserId: input.actorUserId,
      scope: input.scope,
      now,
    });
    await tx.violationSuggestion.update({
      where: { id: s.id },
      data: {
        status: 'confirmed',
        violationId: v.id,
        decidedById: input.actorUserId,
        decidedAt: now,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'violation.suggestion_confirm',
      entityType: 'violation',
      entityId: v.id,
      after: { suggestionId: s.id, day, kind: s.kind },
    });
    return violationView(v, await getSetting(tx, 'hr.appeal_days'), now);
  });
}

/** HR dismisses a suggestion with one tap (audited on the person). */
export function dismissSuggestion(
  db: Db,
  input: { suggestionId: string; actorUserId: string; scope: StoreScope; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const s = await tx.violationSuggestion.findUnique({
      where: { id: input.suggestionId },
      include: { employee: { select: { homeStoreId: true } } },
    });
    if (!s) throw new DomainError('suggestion_not_found', 404);
    if (!inStoreScope(input.scope, s.employee.homeStoreId))
      throw new DomainError('store_not_allowed', 403);
    const done = await tx.violationSuggestion.updateMany({
      where: { id: s.id, status: 'open' },
      data: {
        status: 'dismissed',
        decidedById: input.actorUserId,
        decidedAt: input.now ?? new Date(),
      },
    });
    if (done.count !== 1) throw new DomainError('suggestion_closed');
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'violation.suggestion_dismiss',
      entityType: 'employee',
      entityId: s.employeeId,
      after: { suggestionId: s.id, day: dayText(s.day), kind: s.kind },
    });
    return { dismissed: true };
  });
}

/**
 * Final deductions the salary run has not taken yet, made final before the end of `until`.
 * Only employees (outsourced people are listed for their company instead).
 */
export async function finalDeductionsFor(db: Db, employeeId: string, until: string) {
  return db.violation.findMany({
    where: {
      employeeId,
      status: 'final',
      payrollEntryId: null,
      penalty: { in: ['deduction_days', 'deduction_amount'] },
      finalAt: { lt: cairoDayStart(addDays(until, 1)) },
      employee: { employment: 'employee' },
    },
    select: {
      id: true,
      number: true,
      penalty: true,
      days: true,
      amountPiastres: true,
      type: { select: { nameEn: true } },
    },
    orderBy: { number: 'asc' },
  });
}

/** The API job (with the attendance close): violations past their appeal window become final,
 * then closed attendance days suggest new ones. Both are safe to run twice. */
export async function runViolationJobs(db: Db, now: Date = new Date()) {
  const finals = await finalizeViolations(db, now);
  const suggestions = await suggestViolations(db, now);
  return { ...finals, ...suggestions };
}

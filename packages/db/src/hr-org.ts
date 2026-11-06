import type { Prisma } from '@prisma/client';
import {
  type DepartmentBody,
  type DepartmentUpdateBody,
  employeeCode,
  type GradeBody,
  type GradeUpdateBody,
  type PositionBody,
  type PositionUpdateBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';

// HR v2 (docs/HR.md): the organisation. Departments form a tree with a head each; grades are an
// ordered list; job positions sit in a department with a grade range and a planned headcount.
// A person's manager is the one set on the file, else the head of their department, else the
// head of the department above, and so on. The org chart and team views follow these links.

type Tx = Prisma.TransactionClient;

// ─── the manager graph ─────────────────────────────────────────────────────────

interface GraphPerson {
  id: string;
  managerId: string | null;
  departmentId: string | null;
}
interface GraphDepartment {
  id: string;
  parentId: string | null;
  headEmployeeId: string | null;
}
export interface ManagerLink {
  managerId: string | null;
  /** set: chosen on the file; department: the head of the department chain */
  source: 'set' | 'department' | null;
}

/** Everyone still working here (left people are out of the tree) and every department. */
async function loadGraph(db: Db) {
  const [people, departments] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: 'left' } },
      select: { id: true, managerId: true, departmentId: true },
    }),
    db.department.findMany({ select: { id: true, parentId: true, headEmployeeId: true } }),
  ]);
  return { people, departments };
}

/** The manager of each person: set on the file, or the nearest department head above them. */
export function managerLinks(
  people: GraphPerson[],
  departments: GraphDepartment[],
): Map<string, ManagerLink> {
  const present = new Set(people.map((p) => p.id));
  const dept = new Map(departments.map((d) => [d.id, d]));
  const links = new Map<string, ManagerLink>();
  for (const p of people) {
    if (p.managerId && present.has(p.managerId)) {
      links.set(p.id, { managerId: p.managerId, source: 'set' });
      continue;
    }
    let d = p.departmentId ? dept.get(p.departmentId) : undefined;
    let found: string | null = null;
    for (let i = 0; d && i < 50; i++) {
      if (d.headEmployeeId && d.headEmployeeId !== p.id && present.has(d.headEmployeeId)) {
        found = d.headEmployeeId;
        break;
      }
      d = d.parentId ? dept.get(d.parentId) : undefined;
    }
    links.set(p.id, { managerId: found, source: found ? 'department' : null });
  }
  return links;
}

/** The first person whose manager chain comes back to them, or null. */
export function findManagerLoop(links: Map<string, ManagerLink>): string | null {
  const done = new Set<string>();
  for (const start of links.keys()) {
    if (done.has(start)) continue;
    const path = new Set<string>();
    let cursor: string | null = start;
    while (cursor && !done.has(cursor)) {
      if (path.has(cursor)) return cursor;
      path.add(cursor);
      cursor = links.get(cursor)?.managerId ?? null;
    }
    for (const p of path) done.add(p);
  }
  return null;
}

/** Refuses (and so rolls back) a change after which some manager chain loops. */
export async function assertNoManagerLoop(tx: Tx) {
  const { people, departments } = await loadGraph(tx);
  if (findManagerLoop(managerLinks(people, departments)))
    throw new DomainError('manager_loop', 400);
}

/** The manager of one person (set or from the department chain). */
export async function managerOf(db: Db, employeeId: string): Promise<ManagerLink> {
  const { people, departments } = await loadGraph(db);
  return managerLinks(people, departments).get(employeeId) ?? { managerId: null, source: null };
}

/** Everyone below a person (direct and indirect), with how far down they are. */
export async function teamIds(db: Db, managerEmployeeId: string) {
  const { people, departments } = await loadGraph(db);
  const links = managerLinks(people, departments);
  const children = new Map<string, string[]>();
  for (const [id, link] of links)
    if (link.managerId) children.set(link.managerId, [...(children.get(link.managerId) ?? []), id]);
  const depth = new Map<string, number>();
  const queue: [string, number][] = (children.get(managerEmployeeId) ?? []).map((id) => [id, 1]);
  while (queue.length) {
    const [id, level] = queue.shift()!;
    if (depth.has(id) || id === managerEmployeeId) continue;
    depth.set(id, level);
    for (const c of children.get(id) ?? []) queue.push([c, level + 1]);
  }
  return depth;
}

/** Whether one person is below another (a manager may read their team's files). */
export async function isInTeam(db: Db, managerEmployeeId: string, employeeId: string) {
  return (await teamIds(db, managerEmployeeId)).has(employeeId);
}

// ─── org chart and team ────────────────────────────────────────────────────────

const personSelect = {
  id: true,
  number: true,
  nameEn: true,
  nameAr: true,
  jobTitle: true,
  status: true,
  managerId: true,
  departmentId: true,
  homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  position: { select: { id: true, titleEn: true, titleAr: true } },
  grade: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true } },
  department: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  photo: { select: { updatedAt: true } },
} as const;
type PersonRow = Prisma.EmployeeGetPayload<{ select: typeof personSelect }>;

/** What the chart and the team list show of a person (never pay or documents). */
export function personCard(p: PersonRow, link?: ManagerLink) {
  return {
    id: p.id,
    code: employeeCode(p.number),
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    titleEn: p.position?.titleEn ?? p.jobTitle,
    titleAr: p.position?.titleAr ?? p.jobTitle,
    status: p.status,
    grade: p.grade,
    department: p.department,
    homeStore: p.homeStore,
    managerId: link?.managerId ?? p.managerId,
    managerSource: link?.source ?? (p.managerId ? 'set' : null),
    photoVersion: p.photo ? p.photo.updatedAt.getTime() : null,
  };
}
export type PersonCard = ReturnType<typeof personCard>;

/**
 * The whole organisation for the chart: people with their effective manager, the department
 * tree with headcount, and open places (planned headcount of a position minus people in it).
 */
export async function orgChart(db: Db) {
  const [people, departments, positions] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: 'left' } },
      select: personSelect,
      orderBy: [{ number: 'asc' }],
    }),
    db.department.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        parentId: true,
        headEmployeeId: true,
        sort: true,
      },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    }),
    db.jobPosition.findMany({
      where: { isActive: true, headcountPlanned: { gt: 0 } },
      select: {
        id: true,
        code: true,
        titleEn: true,
        titleAr: true,
        departmentId: true,
        headcountPlanned: true,
        _count: { select: { employees: { where: { status: { not: 'left' } } } } },
      },
    }),
  ]);
  const allDepartments = await db.department.findMany({
    select: { id: true, parentId: true, headEmployeeId: true },
  });
  const links = managerLinks(people, allDepartments);
  const headOf = (departmentId: string) => {
    const dept = new Map(allDepartments.map((d) => [d.id, d]));
    let d = dept.get(departmentId);
    const present = new Set(people.map((p) => p.id));
    for (let i = 0; d && i < 50; i++) {
      if (d.headEmployeeId && present.has(d.headEmployeeId)) return d.headEmployeeId;
      d = d.parentId ? dept.get(d.parentId) : undefined;
    }
    return null;
  };
  return {
    people: people.map((p) => personCard(p, links.get(p.id))),
    departments: departments.map((d) => ({
      ...d,
      headcount: people.filter((p) => p.departmentId === d.id).length,
    })),
    vacancies: positions
      .filter((p) => p.headcountPlanned > p._count.employees)
      .map((p) => ({
        positionId: p.id,
        code: p.code,
        titleEn: p.titleEn,
        titleAr: p.titleAr,
        departmentId: p.departmentId,
        open: p.headcountPlanned - p._count.employees,
        reportsTo: headOf(p.departmentId),
      })),
  };
}

/** A manager's team: everyone below them, direct first, with counts by grade and department. */
export async function teamOf(db: Db, managerEmployeeId: string) {
  const depth = await teamIds(db, managerEmployeeId);
  const [rows, allDepartments, allPeople] = await Promise.all([
    db.employee.findMany({ where: { id: { in: [...depth.keys()] } }, select: personSelect }),
    db.department.findMany({ select: { id: true, parentId: true, headEmployeeId: true } }),
    db.employee.findMany({
      where: { status: { not: 'left' } },
      select: { id: true, managerId: true, departmentId: true },
    }),
  ]);
  const links = managerLinks(allPeople, allDepartments);
  const people = rows
    .map((p) => ({ ...personCard(p, links.get(p.id)), level: depth.get(p.id)! }))
    .sort((a, b) => a.level - b.level || a.nameEn.localeCompare(b.nameEn));
  const count = (key: (p: (typeof people)[number]) => string) => {
    const m = new Map<string, number>();
    for (const p of people) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return [...m.entries()].map(([k, n]) => ({ key: k, count: n }));
  };
  return {
    people,
    direct: people.filter((p) => p.level === 1).length,
    total: people.length,
    byGrade: count((p) => p.grade?.id ?? ''),
    byDepartment: count((p) => p.department?.id ?? ''),
  };
}

// ─── departments ───────────────────────────────────────────────────────────────

export async function listDepartments(db: Db) {
  const rows = await db.department.findMany({
    include: {
      head: { select: { id: true, number: true, nameEn: true, nameAr: true } },
      costStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      _count: { select: { members: { where: { status: { not: 'left' } } }, positions: true } },
    },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  return rows.map((d) => ({
    id: d.id,
    code: d.code,
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    parentId: d.parentId,
    sort: d.sort,
    isActive: d.isActive,
    head: d.head ? { ...d.head, code: employeeCode(d.head.number) } : null,
    costStore: d.costStore,
    members: d._count.members,
    positions: d._count.positions,
  }));
}

async function checkDepartmentRefs(
  tx: Tx,
  id: string | null,
  body: Pick<DepartmentUpdateBody, 'parentId' | 'headEmployeeId' | 'costStoreId'>,
) {
  if (body.parentId) {
    if (body.parentId === id) throw new DomainError('department_loop', 400);
    let cursor: string | null = body.parentId;
    for (let i = 0; cursor && i < 50; i++) {
      const d: { id: string; parentId: string | null } | null = await tx.department.findUnique({
        where: { id: cursor },
        select: { id: true, parentId: true },
      });
      if (!d) throw new DomainError('department_not_found', 404);
      if (d.parentId === id && id) throw new DomainError('department_loop', 400);
      cursor = d.parentId;
    }
  }
  if (body.headEmployeeId) {
    const e = await tx.employee.findUnique({ where: { id: body.headEmployeeId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (e.status === 'left') throw new DomainError('employee_left', 409);
  }
  if (body.costStoreId && !(await tx.darkStore.findUnique({ where: { id: body.costStoreId } })))
    throw new DomainError('dark_store_not_found', 404);
}

const deptSnapshot = (d: Prisma.DepartmentGetPayload<object>) => ({
  code: d.code,
  nameEn: d.nameEn,
  nameAr: d.nameAr,
  parentId: d.parentId,
  headEmployeeId: d.headEmployeeId,
  costStoreId: d.costStoreId,
  sort: d.sort,
  isActive: d.isActive,
});

export function createDepartment(db: Db, input: { body: DepartmentBody; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    if (await tx.department.findUnique({ where: { code: input.body.code } }))
      throw new DomainError('code_taken', 409);
    await checkDepartmentRefs(tx, null, input.body);
    const d = await tx.department.create({
      data: {
        code: input.body.code,
        nameEn: input.body.nameEn,
        nameAr: input.body.nameAr,
        parentId: input.body.parentId ?? null,
        headEmployeeId: input.body.headEmployeeId ?? null,
        costStoreId: input.body.costStoreId ?? null,
        sort: input.body.sort ?? 0,
        isActive: input.body.isActive ?? true,
      },
    });
    await assertNoManagerLoop(tx);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'department.create',
      entityType: 'department',
      entityId: d.id,
      after: deptSnapshot(d),
    });
    return d;
  });
}

export function updateDepartment(
  db: Db,
  input: { id: string; body: DepartmentUpdateBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.department.findUnique({ where: { id: input.id } });
    if (!before) throw new DomainError('department_not_found', 404);
    await checkDepartmentRefs(tx, before.id, input.body);
    if (input.body.isActive === false) {
      const members = await tx.employee.count({
        where: { departmentId: before.id, status: { not: 'left' } },
      });
      const children = await tx.department.count({
        where: { parentId: before.id, isActive: true },
      });
      if (members > 0 || children > 0) throw new DomainError('department_in_use', 409);
    }
    const after = await tx.department.update({
      where: { id: before.id },
      data: {
        nameEn: input.body.nameEn,
        nameAr: input.body.nameAr,
        parentId: input.body.parentId,
        headEmployeeId: input.body.headEmployeeId,
        costStoreId: input.body.costStoreId,
        sort: input.body.sort,
        isActive: input.body.isActive,
      },
    });
    await assertNoManagerLoop(tx);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'department.update',
      entityType: 'department',
      entityId: before.id,
      before: deptSnapshot(before),
      after: deptSnapshot(after),
    });
    return after;
  });
}

// ─── grades ────────────────────────────────────────────────────────────────────

export async function listGrades(db: Db) {
  const rows = await db.grade.findMany({
    include: { _count: { select: { employees: { where: { status: { not: 'left' } } } } } },
    orderBy: { rank: 'asc' },
  });
  return rows.map(({ _count, ...g }) => ({ ...g, people: _count.employees }));
}

const gradeSnapshot = (g: Prisma.GradeGetPayload<object>) => ({
  code: g.code,
  nameEn: g.nameEn,
  nameAr: g.nameAr,
  rank: g.rank,
  bandMinPiastres: g.bandMinPiastres,
  bandMaxPiastres: g.bandMaxPiastres,
  isActive: g.isActive,
});

export function createGrade(db: Db, input: { body: GradeBody; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    if (await tx.grade.findUnique({ where: { code: input.body.code } }))
      throw new DomainError('code_taken', 409);
    if (await tx.grade.findUnique({ where: { rank: input.body.rank } }))
      throw new DomainError('rank_taken', 409);
    const g = await tx.grade.create({
      data: {
        code: input.body.code,
        nameEn: input.body.nameEn,
        nameAr: input.body.nameAr,
        rank: input.body.rank,
        bandMinPiastres: input.body.bandMinPiastres ?? null,
        bandMaxPiastres: input.body.bandMaxPiastres ?? null,
        isActive: input.body.isActive ?? true,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'grade.create',
      entityType: 'grade',
      entityId: g.id,
      after: gradeSnapshot(g),
    });
    return g;
  });
}

export function updateGrade(
  db: Db,
  input: { id: string; body: GradeUpdateBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.grade.findUnique({ where: { id: input.id } });
    if (!before) throw new DomainError('grade_not_found', 404);
    if (input.body.rank !== undefined && input.body.rank !== before.rank) {
      const taken = await tx.grade.findUnique({ where: { rank: input.body.rank } });
      if (taken) throw new DomainError('rank_taken', 409);
    }
    const min =
      input.body.bandMinPiastres === undefined
        ? before.bandMinPiastres
        : input.body.bandMinPiastres;
    const max =
      input.body.bandMaxPiastres === undefined
        ? before.bandMaxPiastres
        : input.body.bandMaxPiastres;
    if (min != null && max != null && min > max) throw new DomainError('band_min_above_max', 400);
    const after = await tx.grade.update({
      where: { id: before.id },
      data: {
        nameEn: input.body.nameEn,
        nameAr: input.body.nameAr,
        rank: input.body.rank,
        bandMinPiastres: input.body.bandMinPiastres,
        bandMaxPiastres: input.body.bandMaxPiastres,
        isActive: input.body.isActive,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'grade.update',
      entityType: 'grade',
      entityId: before.id,
      before: gradeSnapshot(before),
      after: gradeSnapshot(after),
    });
    return after;
  });
}

/** Moves a grade one place up or down the list (swaps ranks with its neighbour). */
export function moveGrade(
  db: Db,
  input: { id: string; direction: 'up' | 'down'; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const g = await tx.grade.findUnique({ where: { id: input.id } });
    if (!g) throw new DomainError('grade_not_found', 404);
    const other = await tx.grade.findFirst({
      where: input.direction === 'up' ? { rank: { gt: g.rank } } : { rank: { lt: g.rank } },
      orderBy: { rank: input.direction === 'up' ? 'asc' : 'desc' },
    });
    if (!other) return g;
    // Ranks are unique: park one out of the way while swapping.
    await tx.grade.update({ where: { id: g.id }, data: { rank: 1_000_000 + g.rank } });
    await tx.grade.update({ where: { id: other.id }, data: { rank: g.rank } });
    const after = await tx.grade.update({ where: { id: g.id }, data: { rank: other.rank } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'grade.move',
      entityType: 'grade',
      entityId: g.id,
      before: { rank: g.rank },
      after: { rank: after.rank },
    });
    return after;
  });
}

// ─── positions ─────────────────────────────────────────────────────────────────

export async function listPositions(db: Db) {
  const rows = await db.jobPosition.findMany({
    include: {
      department: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      minGrade: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true } },
      maxGrade: { select: { id: true, code: true, nameEn: true, nameAr: true, rank: true } },
      _count: { select: { employees: { where: { status: { not: 'left' } } } } },
    },
    orderBy: [{ department: { sort: 'asc' } }, { code: 'asc' }],
  });
  return rows.map(({ _count, ...p }) => ({
    ...p,
    filled: _count.employees,
    open: Math.max(0, p.headcountPlanned - _count.employees),
  }));
}

async function checkPositionRefs(
  tx: Tx,
  body: Pick<PositionUpdateBody, 'departmentId' | 'minGradeId' | 'maxGradeId'>,
  current?: { minGradeId: string | null; maxGradeId: string | null },
) {
  if (body.departmentId && !(await tx.department.findUnique({ where: { id: body.departmentId } })))
    throw new DomainError('department_not_found', 404);
  const minId = body.minGradeId === undefined ? current?.minGradeId : body.minGradeId;
  const maxId = body.maxGradeId === undefined ? current?.maxGradeId : body.maxGradeId;
  const min = minId ? await tx.grade.findUnique({ where: { id: minId } }) : null;
  const max = maxId ? await tx.grade.findUnique({ where: { id: maxId } }) : null;
  if ((minId && !min) || (maxId && !max)) throw new DomainError('grade_not_found', 404);
  if (min && max && min.rank > max.rank) throw new DomainError('grade_range_reversed', 400);
}

const positionSnapshot = (p: Prisma.JobPositionGetPayload<object>) => ({
  code: p.code,
  titleEn: p.titleEn,
  titleAr: p.titleAr,
  departmentId: p.departmentId,
  minGradeId: p.minGradeId,
  maxGradeId: p.maxGradeId,
  headcountPlanned: p.headcountPlanned,
  isActive: p.isActive,
});

export function createPosition(db: Db, input: { body: PositionBody; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    if (await tx.jobPosition.findUnique({ where: { code: input.body.code } }))
      throw new DomainError('code_taken', 409);
    await checkPositionRefs(tx, input.body);
    const p = await tx.jobPosition.create({
      data: {
        code: input.body.code,
        titleEn: input.body.titleEn,
        titleAr: input.body.titleAr,
        departmentId: input.body.departmentId,
        minGradeId: input.body.minGradeId ?? null,
        maxGradeId: input.body.maxGradeId ?? null,
        headcountPlanned: input.body.headcountPlanned,
        isActive: input.body.isActive ?? true,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'position.create',
      entityType: 'job_position',
      entityId: p.id,
      after: positionSnapshot(p),
    });
    return p;
  });
}

export function updatePosition(
  db: Db,
  input: { id: string; body: PositionUpdateBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.jobPosition.findUnique({ where: { id: input.id } });
    if (!before) throw new DomainError('position_not_found', 404);
    await checkPositionRefs(tx, input.body, before);
    const after = await tx.jobPosition.update({
      where: { id: before.id },
      data: {
        titleEn: input.body.titleEn,
        titleAr: input.body.titleAr,
        departmentId: input.body.departmentId,
        minGradeId: input.body.minGradeId,
        maxGradeId: input.body.maxGradeId,
        headcountPlanned: input.body.headcountPlanned,
        isActive: input.body.isActive,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'position.update',
      entityType: 'job_position',
      entityId: before.id,
      before: positionSnapshot(before),
      after: positionSnapshot(after),
    });
    return after;
  });
}

/**
 * Checks a person's department, position and grade together: the position's department wins
 * when no department is given, and the grade must lie inside the position's grade range.
 */
export async function checkPlacement(
  tx: Tx,
  next: { departmentId: string | null; positionId: string | null; gradeId: string | null },
) {
  const position = next.positionId
    ? await tx.jobPosition.findUnique({
        where: { id: next.positionId },
        include: { minGrade: true, maxGrade: true },
      })
    : null;
  if (next.positionId && !position) throw new DomainError('position_not_found', 404);
  if (next.departmentId && !(await tx.department.findUnique({ where: { id: next.departmentId } })))
    throw new DomainError('department_not_found', 404);
  const grade = next.gradeId ? await tx.grade.findUnique({ where: { id: next.gradeId } }) : null;
  if (next.gradeId && !grade) throw new DomainError('grade_not_found', 404);
  if (position && grade) {
    if (position.minGrade && grade.rank < position.minGrade.rank)
      throw new DomainError('grade_outside_position', 400);
    if (position.maxGrade && grade.rank > position.maxGrade.rank)
      throw new DomainError('grade_outside_position', 400);
  }
  return { position };
}

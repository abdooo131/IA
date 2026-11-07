import { addDays, cairoDay, JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getAccessProfile, writeAccess } from '../src/access';
import { createUser } from '../src/admin-ops';
import { setEmployeeStatus } from '../src/hr';
import { ensureHrDefaults } from '../src/hr-defaults';
import {
  employeeDirectory,
  employeeFileCompleteness,
  employeeFlagsFor,
  hrOverview,
} from '../src/hr-overview';
import { createFixture, prisma, resetDatabase } from './helpers';

// HR phase 1 (docs/HR.md "Phase 1 as built"): the HR home, the list's flags and the file's
// completeness, always inside the person's stores.

let f: Awaited<ReturnType<typeof createFixture>>;
let owner: string;
const today = cairoDay(new Date());
const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  owner = (
    await prisma.user.create({
      data: { email: 'owner@t.eg', name: 'Owner', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await prisma.$transaction((tx) =>
    writeAccess(tx, owner, { ...JOB_ROLE_TEMPLATES.owner, jobRole: 'owner' }, []),
  );
  await ensureHrDefaults(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function rider(n: number, storeId: string) {
  const user = await createUser(prisma, {
    email: `rider${n}@t.eg`,
    name: `Rider ${n}`,
    role: 'rider',
    password: 'long-password-1',
    darkStoreId: storeId,
    badgeCode: `R-${n}`,
    phone: `+20101234567${n}`,
    actorUserId: owner,
  });
  return prisma.employee.findUniqueOrThrow({ where: { userId: user.id } });
}

/** Three riders: one in now with dates coming up, one on leave today, one in at the other store. */
async function people() {
  const one = await rider(1, f.store.id);
  const two = await rider(2, f.store.id);
  const three = await rider(3, f.other.id);
  const birth = addDays(today, 2);
  const hire = addDays(today, 3);
  await prisma.employee.update({
    where: { id: one.id },
    data: {
      birthDate: dayDate(`${Number(birth.slice(0, 4)) - 30}${birth.slice(4)}`),
      hireDate: dayDate(`${Number(hire.slice(0, 4)) - 3}${hire.slice(4)}`),
      probationEndsOn: dayDate(addDays(today, 10)),
      contractEndsOn: dayDate(addDays(today, 20)),
      contractType: 'fixed_term',
    },
  });
  // Two clocked in an hour ago, with no shift planned.
  for (const e of [one, three])
    await prisma.punch.create({
      data: { employeeId: e.id, kind: 'in', at: new Date(Date.now() - 3_600_000), source: 'app' },
    });
  const annual = await prisma.leaveType.findFirstOrThrow({ where: { balance: 'annual' } });
  const approved = await prisma.leaveRequest.create({
    data: {
      employeeId: two.id,
      typeId: annual.id,
      fromDay: dayDate(today),
      toDay: dayDate(today),
      days: 1,
      status: 'approved',
      requestedById: owner,
    },
  });
  await prisma.leaveRequestDay.create({
    data: {
      requestId: approved.id,
      employeeId: two.id,
      day: dayDate(today),
      fraction: 1,
    },
  });
  // The other store's rider waits for HR's approval.
  await prisma.leaveRequest.create({
    data: {
      employeeId: three.id,
      typeId: annual.id,
      fromDay: dayDate(addDays(today, 5)),
      toDay: dayDate(addDays(today, 5)),
      days: 1,
      status: 'pending_hr',
      requestedById: owner,
    },
  });
  const late = await prisma.violationType.findFirstOrThrow({ where: { code: 'late_arrival' } });
  await prisma.violation.create({
    data: {
      employeeId: one.id,
      typeId: late.id,
      occurredOn: dayDate(today),
      description: 'Late',
      suggestedStep: 1,
      step: 1,
      penalty: 'written_warning',
      recordedById: owner,
      recordedAt: new Date(),
    },
  });
  return { one, two, three };
}

describe('the HR home', () => {
  it('shows what needs attention today across every store', async () => {
    const { one, two } = await people();
    const access = await getAccessProfile(prisma, owner);
    const o = await hrOverview(prisma, { scope: null, userId: owner, access });
    expect(o.now).toMatchObject({ in: 2, late: 0, absent: 0, onLeave: 1 });
    expect(o.now.onLeaveList.map((p) => p.employee.id)).toEqual([two.id]);
    expect(o.inbox).toMatchObject({ total: 1, leave: 1, corrections: 0, appeals: 0 });
    expect(o.violations.open).toBe(1);
    expect(o.documents.missing).toBeGreaterThan(0);
    expect(o.documents.people).toBe(3);
    // Every new rider started onboarding.
    expect(o.checklists).toMatchObject({ onboarding: 3, offboarding: 0 });
    expect(o.probation).toEqual([
      { employee: expect.objectContaining({ id: one.id }), on: addDays(today, 10) },
    ]);
    expect(o.contracts).toEqual([
      { employee: expect.objectContaining({ id: one.id }), on: addDays(today, 20) },
    ]);
    expect(o.birthdays).toEqual([
      expect.objectContaining({
        on: addDays(today, 2),
        years: 30,
        employee: expect.objectContaining({ id: one.id }),
      }),
    ]);
    expect(o.anniversaries).toEqual([expect.objectContaining({ on: addDays(today, 3), years: 3 })]);
    expect(o.headcount).toMatchObject({
      total: 3,
      active: 3,
      byEmployment: { employee: 3, outsourced: 0 },
    });
    expect(o.headcount.byDepartment).toEqual([
      { department: expect.objectContaining({ code: 'OPS-RID' }), count: 3 },
    ]);
  });

  it('keeps a person limited to some stores to those stores', async () => {
    await people();
    const all = await getAccessProfile(prisma, owner);
    const access = { ...all!, allStores: false, storeIds: [f.store.id] };
    const o = await hrOverview(prisma, { scope: [f.store.id], userId: owner, access });
    expect(o.now).toMatchObject({ in: 1, onLeave: 1 });
    expect(o.headcount.total).toBe(2);
    expect(o.documents.people).toBe(2);
    expect(o.checklists.onboarding).toBe(2);
    // The other store's leave request is not theirs to see.
    expect(o.inbox.leave).toBe(0);
    const other = await hrOverview(prisma, {
      scope: [f.other.id],
      userId: owner,
      access: { ...access, storeIds: [f.other.id] },
    });
    expect(other.violations.open).toBe(0);
    expect(other.probation).toEqual([]);
    expect(other.headcount.total).toBe(1);
  });

  it('counts offboarding of people who left, and their last day ahead as leaving', async () => {
    const { three } = await people();
    await setEmployeeStatus(prisma, {
      employeeId: three.id,
      body: { status: 'left', leftOn: addDays(today, 7), reason: 'Resigned' },
      actorUserId: owner,
      scope: null,
    });
    const access = await getAccessProfile(prisma, owner);
    const o = await hrOverview(prisma, { scope: null, userId: owner, access });
    expect(o.checklists.offboarding).toBe(1);
    expect(o.headcount.total).toBe(2);
    const flags = await employeeFlagsFor(prisma, [
      {
        id: three.id,
        status: 'left',
        leftOn: addDays(today, 7),
        probationEndsOn: null,
        hireDate: null,
      },
    ]);
    expect(flags.get(three.id)!.flags).toEqual(['leaving']);
  });
});

describe('the employee list', () => {
  it('flags people and filters by a flag, sorts and pages', async () => {
    const { one, two, three } = await people();
    const all = await employeeDirectory(prisma, { scope: null });
    expect(all.total).toBe(3);
    const row = (id: string) => all.rows.find((r) => r.id === id)!;
    expect(row(one.id).flags).toEqual(['missing_documents', 'on_probation', 'open_violations']);
    expect(row(one.id).openViolations).toBe(1);
    expect(row(two.id).flags).toContain('on_leave_today');
    // Probation from the hire date (hr.probation_months, 3) when the file has no date.
    expect(row(three.id).probationEndsOn).not.toBeNull();
    expect(all.flagCounts).toMatchObject({
      missing_documents: 3,
      open_violations: 1,
      on_leave_today: 1,
    });

    const onLeave = await employeeDirectory(prisma, { scope: null, flag: 'on_leave_today' });
    expect(onLeave.rows.map((r) => r.id)).toEqual([two.id]);
    const byCode = await employeeDirectory(prisma, { scope: null, sort: 'code', desc: true });
    expect(byCode.rows.map((r) => r.id)).toEqual([three.id, two.id, one.id]);
    const page2 = await employeeDirectory(prisma, {
      scope: null,
      sort: 'code',
      pageSize: 2,
      page: 2,
    });
    expect(page2).toMatchObject({ total: 3, pages: 2, page: 2 });
    expect(page2.rows.map((r) => r.id)).toEqual([three.id]);
    // A page past the end shows the last one.
    expect((await employeeDirectory(prisma, { scope: null, pageSize: 2, page: 9 })).page).toBe(2);
    const phone = await employeeDirectory(prisma, { scope: null, q: '01012345672' });
    expect(phone.rows.map((r) => r.id)).toEqual([two.id]);
    const scoped = await employeeDirectory(prisma, { scope: [f.other.id] });
    expect(scoped.rows.map((r) => r.id)).toEqual([three.id]);
  });
});

describe('file completeness', () => {
  it('lists the fields and documents a file still needs', async () => {
    const { one } = await people();
    const c = await employeeFileCompleteness(prisma, one.id, {
      scope: null,
      confidential: true,
      bank: true,
    });
    const fields = c.missing
      .filter((m) => m.kind === 'field')
      .map((m) => m.kind === 'field' && m.field);
    expect(fields).toEqual(['photo', 'nationalId', 'address', 'emergencyContact', 'bankAccount']);
    expect(c.missing.some((m) => m.kind === 'document')).toBe(true);
    expect(c.percent).toBeLessThan(100);
    // Without the salaries switch the bank account is not asked about.
    const noBank = await employeeFileCompleteness(prisma, one.id, {
      scope: null,
      confidential: true,
      bank: false,
    });
    expect(noBank.total).toBe(c.total - 1);
    await expect(
      employeeFileCompleteness(prisma, one.id, {
        scope: [f.other.id],
        confidential: true,
        bank: false,
      }),
    ).rejects.toThrow('store_not_allowed');
  });
});

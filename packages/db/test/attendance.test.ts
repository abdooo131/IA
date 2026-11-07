import { cairoAt, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addManualPunch,
  attendanceBoard,
  clockPunch,
  closeAttendanceDays,
  createHoliday,
  createShift,
  generateRoster,
  getRoster,
  myAttendance,
  setDayStatus,
  setDefaultShift,
  setRosterCell,
  voidPunch,
} from '../src/attendance';
import { DomainError } from '../src/domain-error';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

// HR step 2 (docs/HR.md 2). The fixture store stands at 30, 31. Wednesday 4 November 2026 is
// in Egypt's winter time (UTC+2).
const D = '2026-11-04';
const at = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return cairoAt(day, h * 60 + m);
};
const AT_STORE = { lat: 30.0005, lng: 31.0005, accuracy: 20 }; // about 70 m away
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

let f: Awaited<ReturnType<typeof createFixture>>;
let owner: string;
let shiftId: string;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  owner = (
    await prisma.user.create({
      data: { email: 'owner@t.eg', name: 'Owner', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  shiftId = (
    await createShift(prisma, {
      body: {
        nameEn: 'Day',
        start: '10:00',
        end: '18:00',
        breakMinutes: 30,
        weekdays: ALL_WEEK,
        overnight: false,
      },
      actorUserId: owner,
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A store staff member of the fixture store with a file and (by default) the day shift. */
async function person(
  name: string,
  options: { shift?: string | null; store?: string | null } = {},
) {
  const store = options.store === undefined ? f.store.id : options.store;
  const user = await prisma.user.create({
    data: {
      email: `${name}@t.eg`,
      name,
      role: store ? 'store_staff' : 'admin',
      darkStoreId: store,
      passwordHash: 'x',
    },
  });
  const employee = await prisma.employee.create({
    data: { userId: user.id, nameEn: name, homeStoreId: store },
  });
  const shift = options.shift === undefined ? shiftId : options.shift;
  if (shift)
    await setDefaultShift(prisma, {
      employeeId: employee.id,
      shiftId: shift,
      actorUserId: owner,
      scope: null,
      now: at(D, '00:30'),
    });
  return { userId: user.id, employeeId: employee.id };
}

const punch = (userId: string, kind: 'in' | 'out', now: Date, position = AT_STORE) =>
  clockPunch(prisma, { userId, kind, position, now });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, ...error.details };
    throw error;
  }
  throw new Error('expected a refusal');
}

const dayOf = (employeeId: string, day = D) =>
  prisma.attendanceDay.findUniqueOrThrow({
    where: { employeeId_day: { employeeId, day: new Date(`${day}T00:00:00Z`) } },
  });

describe('clock in and out', () => {
  it('checks the position, its accuracy and the distance to the store', async () => {
    const p = await person('ali');
    const now = at(D, '09:55');
    expect(
      await refusal(clockPunch(prisma, { userId: p.userId, kind: 'in', position: null, now })),
    ).toEqual({ code: 'no_position' });
    expect(await refusal(punch(p.userId, 'in', now, { ...AT_STORE, accuracy: 250 }))).toEqual({
      code: 'position_inaccurate',
      accuracyM: 250,
      maxAccuracyM: 100,
    });
    // About 1.1 km north of the store.
    const far = await refusal(punch(p.userId, 'in', now, { lat: 30.01, lng: 31, accuracy: 10 }));
    expect(far).toMatchObject({ code: 'too_far', radiusM: 150 });
    expect((far as { distanceM: number }).distanceM).toBeGreaterThan(1000);

    // A wider radius for this store lets the same position in.
    await setSetting(prisma, {
      key: 'hr.clock_radius_m',
      value: 1500,
      scope: f.store.id,
      actorUserId: owner,
    });
    const ok = await punch(p.userId, 'in', now, { lat: 30.01, lng: 31, accuracy: 10 });
    expect(ok.kind).toBe('in');
    const saved = await prisma.punch.findUniqueOrThrow({ where: { id: ok.id } });
    expect(saved).toMatchObject({ source: 'app', accuracyM: 10, darkStoreId: f.store.id });
    expect(
      await prisma.auditLog.count({
        where: { action: 'attendance.clock_in', entityId: p.employeeId },
      }),
    ).toBe(1);
  });

  it('refuses a second clock in and an out without an in', async () => {
    const p = await person('ali');
    expect(await refusal(punch(p.userId, 'out', at(D, '09:00')))).toEqual({
      code: 'not_clocked_in',
    });
    await punch(p.userId, 'in', at(D, '09:58'));
    expect(await refusal(punch(p.userId, 'in', at(D, '10:01')))).toEqual({
      code: 'already_clocked_in',
    });
    await punch(p.userId, 'out', at(D, '18:02'));
    const mine = await myAttendance(prisma, { userId: p.userId, now: at(D, '18:05') });
    expect(mine.today).toMatchObject({ clockedIn: false, lateMinutes: 0, late: false });
    expect(mine.today.workedMinutes).toBe(484);
  });

  it('checks office staff against the office, which must be set', async () => {
    const p = await person('nour', { store: null });
    expect(await refusal(punch(p.userId, 'in', at(D, '09:55')))).toEqual({
      code: 'office_location_not_set',
    });
    await setSetting(prisma, { key: 'hr.office_lat', value: 30.05, actorUserId: owner });
    await setSetting(prisma, { key: 'hr.office_lng', value: 31.25, actorUserId: owner });
    expect(await refusal(punch(p.userId, 'in', at(D, '09:55')))).toMatchObject({
      code: 'too_far',
    });
    const done = await punch(p.userId, 'in', at(D, '09:55'), {
      lat: 30.0503,
      lng: 31.2502,
      accuracy: 15,
    });
    expect(done.distanceM).toBeLessThan(150);
  });
});

describe('the daily close', () => {
  it('turns the roster and the punches into statuses', async () => {
    const onTime = await person('ontime');
    const late = await person('late');
    const early = await person('early');
    const absent = await person('absent');
    const overtime = await person('overtime');
    const unplanned = await person('unplanned', { shift: null });

    await punch(onTime.userId, 'in', at(D, '10:08'));
    await punch(onTime.userId, 'out', at(D, '18:20'));
    await punch(late.userId, 'in', at(D, '10:25'));
    await punch(late.userId, 'out', at(D, '18:00'));
    await punch(early.userId, 'in', at(D, '09:50'));
    await punch(early.userId, 'out', at(D, '17:00'));
    await punch(overtime.userId, 'in', at(D, '10:00'));
    await punch(overtime.userId, 'out', at(D, '18:45'));
    await punch(unplanned.userId, 'in', at(D, '12:00'));
    await punch(unplanned.userId, 'out', at(D, '14:00'));

    // The live board in the middle of the day.
    const board = await attendanceBoard(prisma, { scope: null, now: at(D, '12:30') });
    const state = (id: string) => board.people.find((b) => b.employee.id === id)?.state;
    expect(state(onTime.employeeId)).toBe('in');
    expect(state(late.employeeId)).toBe('late_in');
    expect(state(absent.employeeId)).toBe('missing');
    expect(state(unplanned.employeeId)).toBe('in');

    // Not over yet: nothing closed.
    expect((await closeAttendanceDays(prisma, at(D, '23:00'))).closed).toBe(0);
    const result = await closeAttendanceDays(prisma, at('2026-11-05', '05:00'));
    expect(result.closed).toBe(6);
    expect(await dayOf(onTime.employeeId)).toMatchObject({
      status: 'present',
      lateMinutes: 8,
      overtimeMinutes: 0, // 20 minutes past the end is under hr.overtime_after_minutes
      workedMinutes: 492 - 30,
    });
    expect(await dayOf(late.employeeId)).toMatchObject({ status: 'late', lateMinutes: 25 });
    expect(await dayOf(early.employeeId)).toMatchObject({
      status: 'left_early',
      earlyMinutes: 60,
      lateMinutes: 0,
    });
    expect(await dayOf(absent.employeeId)).toMatchObject({ status: 'absent', workedMinutes: 0 });
    expect(await dayOf(overtime.employeeId)).toMatchObject({
      status: 'present',
      overtimeMinutes: 45,
    });
    expect(await dayOf(unplanned.employeeId)).toMatchObject({
      status: 'present',
      workedMinutes: 120,
    });

    // Running it again changes nothing.
    expect((await closeAttendanceDays(prisma, at('2026-11-05', '05:10'))).closed).toBe(0);
    expect(await prisma.attendanceDay.count({ where: { day: new Date(`${D}T00:00:00Z`) } })).toBe(
      6,
    );
  });

  it('keeps an overnight shift on the day it started', async () => {
    const night = (
      await createShift(prisma, {
        body: {
          nameEn: 'Night',
          start: '22:00',
          end: '06:00',
          breakMinutes: 0,
          weekdays: ALL_WEEK,
          overnight: true,
        },
        actorUserId: owner,
      })
    ).id;
    await expect(
      createShift(prisma, {
        body: {
          nameEn: 'Bad',
          start: '22:00',
          end: '06:00',
          breakMinutes: 0,
          weekdays: [1],
          overnight: false,
        },
        actorUserId: owner,
      }),
    ).rejects.toThrow('shift_crosses_midnight');
    const p = await person('owl', { shift: night });
    await punch(p.userId, 'in', at(D, '21:55'));
    await punch(p.userId, 'out', at('2026-11-05', '06:10'));
    // Before the shift end plus hr.auto_close_hours the day stays open.
    await closeAttendanceDays(prisma, at('2026-11-05', '09:00'));
    expect(
      await prisma.attendanceDay.count({
        where: { employeeId: p.employeeId, day: new Date(`${D}T00:00:00Z`) },
      }),
    ).toBe(0);
    await closeAttendanceDays(prisma, at('2026-11-05', '10:05'));
    expect(await dayOf(p.employeeId)).toMatchObject({
      status: 'present',
      lateMinutes: 0,
      workedMinutes: 495,
    });
    // The morning out did not open a day of its own.
    expect(
      await prisma.attendanceDay.findFirst({
        where: {
          employeeId: p.employeeId,
          day: new Date('2026-11-05T00:00:00Z'),
          workedMinutes: { gt: 0 },
        },
      }),
    ).toBeNull();
  });

  it('clocks out a forgotten clock out at the shift end and flags it', async () => {
    const p = await person('forgetful');
    await punch(p.userId, 'in', at(D, '10:00'));
    // Next morning the person clocks in again: yesterday is closed first.
    await punch(p.userId, 'in', at('2026-11-05', '09:58'));
    const day = await dayOf(p.employeeId);
    expect(day).toMatchObject({ status: 'present', workedMinutes: 450 });
    expect(day.flags).toContain('forgot_clock_out');
    expect(day.lastOut?.toISOString()).toBe(at(D, '18:00').toISOString());
    const auto = await prisma.punch.findMany({
      where: { employeeId: p.employeeId, source: 'auto' },
    });
    expect(auto).toHaveLength(1);
    // The close job afterwards adds nothing.
    await closeAttendanceDays(prisma, at('2026-11-05', '12:00'));
    expect(await prisma.punch.count({ where: { employeeId: p.employeeId, source: 'auto' } })).toBe(
      1,
    );
  });

  it('builds a day again when punches or the status are corrected', async () => {
    const p = await person('fixme');
    await closeAttendanceDays(prisma, at('2026-11-05', '03:00'));
    expect((await dayOf(p.employeeId)).status).toBe('absent');

    // The phone was broken: the manager adds the punches with a reason.
    const added = await addManualPunch(prisma, {
      body: {
        employeeId: p.employeeId,
        kind: 'in',
        at: at(D, '10:30').toISOString(),
        reason: 'Phone broken',
      },
      actorUserId: owner,
      scope: null,
      now: at('2026-11-05', '09:00'),
    });
    await addManualPunch(prisma, {
      body: {
        employeeId: p.employeeId,
        kind: 'out',
        at: at(D, '18:00').toISOString(),
        reason: 'Phone broken',
      },
      actorUserId: owner,
      scope: null,
      now: at('2026-11-05', '09:00'),
    });
    let day = await dayOf(p.employeeId);
    expect(day).toMatchObject({ status: 'late', lateMinutes: 30 });
    expect(day.flags).toContain('manual_punch');

    // The manager accepts the lateness (traffic accident on the ring road).
    await setDayStatus(prisma, {
      body: { employeeId: p.employeeId, day: D, status: 'present', reason: 'Accident on the road' },
      actorUserId: owner,
      scope: null,
      now: at('2026-11-05', '09:05'),
    });
    day = await dayOf(p.employeeId);
    expect(day).toMatchObject({
      status: 'present',
      computedStatus: 'late',
      overrideStatus: 'present',
    });

    // Voiding the in punch builds the day again; the manager's status stays.
    await voidPunch(prisma, {
      punchId: added.id,
      reason: 'Entered by mistake',
      actorUserId: owner,
      scope: null,
      now: at('2026-11-05', '09:10'),
    });
    day = await dayOf(p.employeeId);
    expect(day).toMatchObject({ status: 'present', computedStatus: 'absent' });
    await expect(prisma.$executeRaw`DELETE FROM punches WHERE id = ${added.id}`).rejects.toThrow();
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: p.employeeId,
          action: {
            in: ['attendance.manual_punch', 'attendance.void_punch', 'attendance.day_status'],
          },
        },
      }),
    ).toBe(4);
  });

  it('marks official holidays and counts work on them as overtime', async () => {
    const rests = await person('rests');
    const works = await person('works');
    await createHoliday(prisma, {
      body: { day: D, nameEn: 'Test holiday', nameAr: 'إجازة' },
      actorUserId: owner,
      now: at(D, '00:00'),
    });
    await punch(works.userId, 'in', at(D, '10:00'));
    await punch(works.userId, 'out', at(D, '14:00'));
    await closeAttendanceDays(prisma, at('2026-11-05', '03:00'));
    expect(await dayOf(rests.employeeId)).toMatchObject({ status: 'holiday', workedMinutes: 0 });
    expect(await dayOf(works.employeeId)).toMatchObject({
      status: 'holiday',
      workedMinutes: 210,
      overtimeMinutes: 210,
    });
  });
});

describe('the roster', () => {
  it('is generated from the default shift and edited per day', async () => {
    const weekdaysOnly = (
      await createShift(prisma, {
        body: {
          nameEn: 'Sun to Thu',
          start: '09:00',
          end: '17:00',
          breakMinutes: 60,
          weekdays: [0, 1, 2, 3, 4],
          overnight: false,
        },
        actorUserId: owner,
      })
    ).id;
    const p = await person('planned', { shift: weekdaysOnly });
    // Generating again changes nothing.
    expect((await generateRoster(prisma, { from: D, days: 7 })).created).toBe(0);
    const week = await getRoster(prisma, { storeId: f.store.id, week: D, scope: null });
    expect(week.from).toBe('2026-10-31'); // Saturday
    const row = week.people.find((x) => x.id === p.employeeId)!;
    // Saturday and Sunday 31 Oct, 1 Nov were before the default shift was set (the 4th).
    expect(row.cells.slice(4).map((c) => c?.start ?? (c ? 'off' : null))).toEqual([
      '09:00',
      '09:00',
      'off',
    ]);

    await setRosterCell(prisma, {
      body: { employeeId: p.employeeId, day: '2026-11-06', shiftId },
      actorUserId: owner,
      scope: null,
    });
    const again = await getRoster(prisma, { storeId: f.store.id, week: D, scope: null });
    expect(again.people.find((x) => x.id === p.employeeId)!.cells[6]).toMatchObject({
      start: '10:00',
      edited: true,
    });
    await expect(
      getRoster(prisma, { storeId: f.store.id, week: D, scope: [f.other.id] }),
    ).rejects.toThrow('store_not_allowed');
    expect(cairoDay(at(D, '23:59'))).toBe(D);
  });
});

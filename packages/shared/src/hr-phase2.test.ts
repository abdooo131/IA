import { describe, expect, it } from 'vitest';
import {
  accountRoleFor,
  defaultHireAccess,
  exitSettlement,
  hireAccessValues,
  hireDraftDataSchema,
  hireProgress,
  hireStepIssues,
  hireSteps,
  leavingSchema,
  nextHireStep,
  noticeCheck,
} from './hr-phase2';

const blank = hireDraftDataSchema.parse({});
const today = '2026-11-07';

describe('new hire wizard steps', () => {
  it('skips the pay step without the salaries switch and for outsourced people', () => {
    expect(hireSteps({ canPay: true })).toEqual([
      'person',
      'job',
      'pay',
      'documents',
      'access',
      'review',
    ]);
    expect(hireSteps({ canPay: false })).not.toContain('pay');
    expect(hireSteps({ canPay: true, employment: 'outsourced' })).not.toContain('pay');
    const steps = hireSteps({ canPay: false });
    expect(nextHireStep(steps, 'job', 1)).toBe('documents');
    expect(nextHireStep(steps, 'person', -1)).toBe('person');
    expect(nextHireStep(steps, 'review', 1)).toBe('review');
    expect(hireProgress(steps, 'person')).toBe(0);
    expect(hireProgress(steps, 'review')).toBe(100);
  });

  it('says what each step still needs', () => {
    expect(hireStepIssues(blank, 'person', { today })).toEqual({
      'person.nameEn': 'required',
      'person.mobile': 'required',
    });
    const person = hireStepIssues(
      {
        ...blank,
        person: {
          nameEn: 'Mona',
          mobile: '0161234567',
          nationalId: '123',
          birthDate: '2030-01-01',
        },
      },
      'person',
      { today },
    );
    expect(person).toEqual({
      'person.mobile': 'invalid_egyptian_phone',
      'person.nationalId': 'invalid_national_id',
      'person.birthDate': 'in_future',
    });
    const rider = hireStepIssues(
      {
        ...blank,
        job: {
          kind: 'rider',
          positionId: 'pos_rider',
          hireDate: '2026-11-10',
          employment: 'outsourced',
          contractType: 'fixed_term',
          probationEndsOn: '2026-11-01',
        },
      },
      'job',
      { today },
    );
    expect(rider).toEqual({
      'job.storeIds': 'one_store',
      'job.badgeCode': 'required',
      'job.staffingSupplierId': 'required',
      'job.contractEndsOn': 'required',
      'job.probationEndsOn': 'before_hire',
    });
    // Pay: the basic salary, a valid IBAN; nothing for outsourced people.
    expect(hireStepIssues({ ...blank, pay: { iban: 'EG12' } }, 'pay', { today })).toEqual({
      'pay.basicPiastres': 'required',
      'pay.iban': 'invalid_iban',
    });
    expect(
      hireStepIssues({ ...blank, job: { employment: 'outsourced' } }, 'pay', { today }),
    ).toEqual({});
    // A login needs an email, a job role and stores; riders always sign in.
    expect(
      hireStepIssues({ ...blank, access: { login: true, allStores: false } }, 'access', { today }),
    ).toEqual({
      'person.email': 'required_for_login',
      'access.jobRole': 'required',
      'access.storeIds': 'required',
    });
    expect(hireStepIssues({ ...blank, access: { login: false } }, 'access', { today })).toEqual({});
    expect(
      hireStepIssues({ ...blank, job: { kind: 'rider' }, access: { login: false } }, 'access', {
        today,
      }),
    ).toEqual({ 'person.email': 'required_for_login' });
    // The review step is every step together.
    const all = hireStepIssues(blank, 'review', { today, steps: hireSteps({ canPay: false }) });
    expect(Object.keys(all)).toContain('job.hireDate');
    expect(Object.keys(all)).not.toContain('pay.basicPiastres');
  });

  it('starts the access step from the position and picks the account kind', () => {
    expect(defaultHireAccess({ positionCode: 'PICKER', storeIds: ['s1'] })).toMatchObject({
      login: true,
      jobRole: 'store_staff',
      allStores: false,
      storeIds: ['s1'],
    });
    expect(defaultHireAccess({ positionCode: 'HR-MGR' })).toMatchObject({
      jobRole: 'hr_manager',
      allStores: true,
      salaries: true,
    });
    expect(defaultHireAccess({ positionCode: 'NEW-ONE' }).jobRole).toBe('');
    expect(accountRoleFor('rider', '')).toBe('rider');
    expect(accountRoleFor('team', 'hub_staff')).toBe('store_staff');
    expect(accountRoleFor('team', 'accountant')).toBe('finance');
    expect(accountRoleFor('team', 'hr_officer')).toBe('admin');
    // Switches on top of a job role make it custom.
    expect(hireAccessValues({ jobRole: 'hr_officer' }).jobRole).toBe('hr_officer');
    expect(hireAccessValues({ jobRole: 'hr_officer', salaries: true }).jobRole).toBe('hr_manager');
    expect(hireAccessValues({ jobRole: 'store_staff', customerData: true }).jobRole).toBe('custom');
  });
});

describe('leaving wizard', () => {
  it('checks the notice period', () => {
    expect(
      noticeCheck({ noticeGivenOn: '2026-10-01', lastDay: '2026-10-31', noticeDays: 30 }),
    ).toEqual({ givenDays: 30, shortBy: 0 });
    expect(
      noticeCheck({ noticeGivenOn: '2026-10-21', lastDay: '2026-10-31', noticeDays: 30 }),
    ).toEqual({ givenDays: 10, shortBy: 20 });
    expect(noticeCheck({ noticeGivenOn: null, lastDay: '2026-10-31', noticeDays: 30 })).toEqual({
      givenDays: null,
      shortBy: 30,
    });
  });

  it('works out the settlement figures', () => {
    const base = {
      lastDay: '2026-11-15',
      hireDate: '2024-01-01',
      basicPiastres: 900_000,
      daysPerMonth: 30,
      annualRemaining: 10.5,
      payUnusedLeave: true,
      unpaidLeaveDays: 2,
      deductions: [
        { days: 1, amountPiastres: null },
        { days: null, amountPiastres: 5_000 },
      ],
      advancePiastres: 40_000,
      commissionPiastres: 12_000,
    };
    const s = exitSettlement(base);
    expect(s).toMatchObject({
      from: '2026-11-01',
      daysWorked: 15,
      lastMonthPayPiastres: 450_000,
      leaveDaysToPay: 10.5,
      leavePayPiastres: 315_000,
      leaveDaysAhead: 0,
      unpaidLeavePiastres: 60_000,
      deductionDays: 1,
      deductionsPiastres: 35_000,
      advancePiastres: 40_000,
      commissionPiastres: 12_000,
    });
    expect(s.netPiastres).toBe(450_000 + 315_000 + 12_000 - 60_000 - 35_000 - 40_000);
    // A whole month is the basic itself; joining this month counts from the hire day.
    expect(exitSettlement({ ...base, lastDay: '2026-11-30' }).lastMonthPayPiastres).toBe(900_000);
    expect(exitSettlement({ ...base, hireDate: '2026-11-10' }).daysWorked).toBe(6);
    // Leave taken ahead comes off; unused leave is not paid when the setting says no.
    const ahead = exitSettlement({ ...base, annualRemaining: -2, payUnusedLeave: false });
    expect(ahead).toMatchObject({
      leaveDaysToPay: 0,
      leaveDaysAhead: 2,
      leaveAheadPiastres: 60_000,
    });
    // Without a known salary the money is unknown, the days stay.
    const unknown = exitSettlement({ ...base, basicPiastres: null });
    expect(unknown).toMatchObject({
      daysWorked: 15,
      lastMonthPayPiastres: null,
      netPiastres: null,
    });
  });

  it('needs a note for other and a notice before the last day', () => {
    const ok = {
      lastDay: '2026-11-30',
      reason: 'resignation',
      idempotencyKey: 'key-12345678',
    };
    expect(leavingSchema.safeParse(ok).success).toBe(true);
    expect(leavingSchema.safeParse({ ...ok, reason: 'other' }).success).toBe(false);
    expect(leavingSchema.safeParse({ ...ok, reason: 'other', note: 'Moved' }).success).toBe(true);
    expect(leavingSchema.safeParse({ ...ok, noticeGivenOn: '2026-12-01' }).success).toBe(false);
  });
});

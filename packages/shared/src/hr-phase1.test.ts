import { describe, expect, it } from 'vitest';
import {
  employeeFlags,
  fileCompleteness,
  nextYearly,
  probationEnd,
  withinNextDays,
} from './hr-phase1';

const full = {
  hasPhoto: true,
  mobile: '+201012345678',
  nationalId: '29001011234567',
  birthDate: '1990-01-01',
  address: 'Maadi',
  emergencyName: 'Mona',
  emergencyPhone: '+201112345678',
  hireDate: '2026-01-10',
  documents: [],
};

describe('file completeness', () => {
  it('is complete when every field and required document is on file', () => {
    expect(fileCompleteness(full)).toEqual({ done: 7, total: 7, percent: 100, missing: [] });
  });

  it('lists exactly what is missing, fields first, then required documents', () => {
    const result = fileCompleteness({
      ...full,
      hasPhoto: false,
      nationalId: ' ',
      emergencyPhone: null,
      bank: { iban: null, bankAccountNumber: null },
      documents: [
        { required: true, state: 'verified', type: { id: 'a', nameEn: 'ID', nameAr: 'بطاقة' } },
        { required: true, state: 'expiring', type: { id: 'b', nameEn: 'B', nameAr: 'ب' } },
        { required: true, state: 'pending', type: { id: 'c', nameEn: 'C', nameAr: 'ج' } },
        { required: false, state: 'missing', type: { id: 'd', nameEn: 'D', nameAr: 'د' } },
      ],
    });
    expect(result.total).toBe(11);
    expect(result.done).toBe(6);
    expect(result.percent).toBe(54);
    expect(result.missing).toEqual([
      { kind: 'field', field: 'photo' },
      { kind: 'field', field: 'nationalId' },
      { kind: 'field', field: 'emergencyContact' },
      { kind: 'field', field: 'bankAccount' },
      { kind: 'document', typeId: 'c', nameEn: 'C', nameAr: 'ج', state: 'pending' },
    ]);
  });

  it('checks the bank account only when asked, and an IBAN or an account number is enough', () => {
    expect(fileCompleteness({ ...full, bank: undefined }).total).toBe(7);
    expect(
      fileCompleteness({ ...full, bank: { iban: null, bankAccountNumber: '123' } }).percent,
    ).toBe(100);
    expect(fileCompleteness({ ...full, bank: null }).missing).toEqual([
      { kind: 'field', field: 'bankAccount' },
    ]);
  });

  it('never rounds an incomplete file up to 100', () => {
    const documents = Array.from({ length: 200 }, (_, i) => ({
      required: true,
      state: i === 0 ? 'missing' : 'verified',
      type: { id: String(i), nameEn: 'x', nameAr: 'x' },
    }));
    expect(fileCompleteness({ ...full, documents }).percent).toBe(99);
  });
});

describe('probation and yearly dates', () => {
  it('uses the file date, else the hire date plus the months less a day', () => {
    expect(probationEnd({ probationEndsOn: '2026-05-01', hireDate: '2026-01-01', months: 3 })).toBe(
      '2026-05-01',
    );
    expect(probationEnd({ probationEndsOn: null, hireDate: '2026-01-10', months: 3 })).toBe(
      '2026-04-09',
    );
    expect(probationEnd({ probationEndsOn: null, hireDate: '2026-11-30', months: 3 })).toBe(
      '2027-02-27',
    );
    expect(probationEnd({ probationEndsOn: null, hireDate: '2026-01-10', months: 0 })).toBeNull();
    expect(probationEnd({ probationEndsOn: null, hireDate: null, months: 3 })).toBeNull();
  });

  it('finds the next birthday or anniversary and the years it marks', () => {
    expect(nextYearly('1990-11-09', '2026-11-07')).toEqual({ day: '2026-11-09', years: 36 });
    expect(nextYearly('1990-11-07', '2026-11-07')).toEqual({ day: '2026-11-07', years: 36 });
    expect(nextYearly('2024-01-02', '2026-11-07')).toEqual({ day: '2027-01-02', years: 3 });
    expect(nextYearly('2000-02-29', '2027-02-01')).toEqual({ day: '2027-02-28', years: 27 });
    expect(nextYearly('2000-02-29', '2028-02-01')).toEqual({ day: '2028-02-29', years: 28 });
    expect(withinNextDays('2026-11-13', '2026-11-07', 6)).toBe(true);
    expect(withinNextDays('2026-11-14', '2026-11-07', 6)).toBe(false);
    expect(withinNextDays('2026-11-06', '2026-11-07', 6)).toBe(false);
    expect(withinNextDays(null, '2026-11-07', 6)).toBe(false);
  });
});

describe('list flags', () => {
  const base = {
    status: 'active',
    leftOn: null,
    probationEndsOn: null,
    missingDocuments: 0,
    onLeaveToday: false,
    openViolations: 0,
  };
  const today = '2026-11-07';
  it('flags documents, probation, leave and violations', () => {
    expect(employeeFlags(base, today)).toEqual([]);
    expect(
      employeeFlags(
        {
          ...base,
          missingDocuments: 2,
          probationEndsOn: today,
          onLeaveToday: true,
          openViolations: 1,
        },
        today,
      ),
    ).toEqual(['missing_documents', 'on_probation', 'on_leave_today', 'open_violations']);
    expect(employeeFlags({ ...base, status: 'on_leave' }, today)).toEqual(['on_leave_today']);
    expect(employeeFlags({ ...base, probationEndsOn: '2026-11-06' }, today)).toEqual([]);
  });

  it('tells leaving (last day ahead) from left, and drops file flags once gone', () => {
    const gone = { ...base, status: 'left', missingDocuments: 3, probationEndsOn: '2027-01-01' };
    expect(employeeFlags({ ...gone, leftOn: '2026-11-20' }, today)).toEqual(['leaving']);
    expect(employeeFlags({ ...gone, leftOn: today }, today)).toEqual(['left']);
  });
});

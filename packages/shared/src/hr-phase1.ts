import { addDays } from './hours';

/**
 * HR phase 1 (docs/HR.md "Phase 1 as built"): the HR home, the employee list's flags and the
 * file's completeness. No new business rules: these only read what the file already holds.
 */

/** The coloured flags on the employee list (and its flag filter). */
export const EMPLOYEE_FLAGS = [
  'missing_documents',
  'on_probation',
  'leaving',
  'left',
  'on_leave_today',
  'open_violations',
] as const;
export type EmployeeFlag = (typeof EMPLOYEE_FLAGS)[number];

/** How the employee list can be sorted. */
export const DIRECTORY_SORTS = [
  'name',
  'code',
  'hired',
  'department',
  'store',
  'documents',
] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

/** Rows per page of the employee list. */
export const DIRECTORY_PAGE_SIZE = 50;

/**
 * The last day of probation: the file's own date, else the hire date plus `months`
 * (hr.probation_months) less one day, as a new file is filled in. Null without either, or with
 * 0 months.
 */
export function probationEnd(input: {
  probationEndsOn: string | null;
  hireDate: string | null;
  months: number;
}): string | null {
  if (input.probationEndsOn) return input.probationEndsOn;
  if (!input.hireDate || input.months <= 0) return null;
  const [y, m, d] = input.hireDate.split('-').map(Number) as [number, number, number];
  // Same day n months later (clamped to the month's last day), then the day before.
  const target = new Date(Date.UTC(y, m - 1 + input.months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0));
  target.setUTCDate(Math.min(d, last.getUTCDate()));
  return addDays(target.toISOString().slice(0, 10), -1);
}

/**
 * The next time a yearly date (a birthday, a hire day) comes round on or after `today`, with
 * the number of years it marks. 29 February falls on 28 February in other years.
 */
export function nextYearly(date: string, today: string): { day: string; years: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ty = Number(today.slice(0, 4));
  const on = (year: number) => {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  let year = ty;
  if (on(year) < today) year += 1;
  return { day: on(year), years: year - y };
}

/** Whether a day falls from today up to `days` days ahead (today included). */
export function withinNextDays(day: string | null, today: string, days: number) {
  return !!day && day >= today && day <= addDays(today, days);
}

/** The list flags of one person, from what the file and its records hold today. */
export function employeeFlags(
  e: {
    status: string;
    leftOn: string | null;
    probationEndsOn: string | null;
    missingDocuments: number;
    onLeaveToday: boolean;
    openViolations: number;
  },
  today: string,
): EmployeeFlag[] {
  const flags: EmployeeFlag[] = [];
  const gone = e.status === 'left';
  if (!gone && e.missingDocuments > 0) flags.push('missing_documents');
  if (!gone && e.probationEndsOn && e.probationEndsOn >= today) flags.push('on_probation');
  if (gone) flags.push(e.leftOn && e.leftOn > today ? 'leaving' : 'left');
  if (!gone && (e.status === 'on_leave' || e.onLeaveToday)) flags.push('on_leave_today');
  if (e.openViolations > 0) flags.push('open_violations');
  return flags;
}

/** The fields the file's completeness checks (bank only for employees, with the salaries switch). */
export const FILE_FIELDS = [
  'photo',
  'mobile',
  'nationalId',
  'birthDate',
  'address',
  'emergencyContact',
  'hireDate',
  'bankAccount',
] as const;
export type FileField = (typeof FILE_FIELDS)[number];

export type CompletenessGap =
  | { kind: 'field'; field: FileField }
  | {
      kind: 'document';
      typeId: string;
      nameEn: string;
      nameAr: string;
      state: string;
    };

export interface FileCompletenessInput {
  hasPhoto: boolean;
  mobile: string | null;
  nationalId: string | null;
  birthDate: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  hireDate: string | null;
  /** Only checked when given: employees on our payroll, read with the salaries switch */
  bank?: { iban: string | null; bankAccountNumber: string | null } | null;
  /** Required document types and where each stands */
  documents: {
    required: boolean;
    state: string;
    type: { id: string; nameEn: string; nameAr: string };
  }[];
}

const filled = (v: string | null | undefined) => !!v && v.trim().length > 0;
/** A document that counts as on file (as the documents checklist counts it). */
const documentDone = (state: string) => state === 'verified' || state === 'expiring';

/**
 * How complete a file is: each field and each required document counts once. Returns the
 * percent and exactly what is missing, in the order the file shows it.
 */
export function fileCompleteness(input: FileCompletenessInput) {
  const checks: { done: boolean; gap: CompletenessGap }[] = [
    { done: input.hasPhoto, gap: { kind: 'field', field: 'photo' } },
    { done: filled(input.mobile), gap: { kind: 'field', field: 'mobile' } },
    { done: filled(input.nationalId), gap: { kind: 'field', field: 'nationalId' } },
    { done: filled(input.birthDate), gap: { kind: 'field', field: 'birthDate' } },
    { done: filled(input.address), gap: { kind: 'field', field: 'address' } },
    {
      done: filled(input.emergencyName) && filled(input.emergencyPhone),
      gap: { kind: 'field', field: 'emergencyContact' },
    },
    { done: filled(input.hireDate), gap: { kind: 'field', field: 'hireDate' } },
  ];
  if (input.bank !== undefined)
    checks.push({
      done: filled(input.bank?.iban) || filled(input.bank?.bankAccountNumber),
      gap: { kind: 'field', field: 'bankAccount' },
    });
  for (const d of input.documents.filter((x) => x.required))
    checks.push({
      done: documentDone(d.state),
      gap: {
        kind: 'document',
        typeId: d.type.id,
        nameEn: d.type.nameEn,
        nameAr: d.type.nameAr,
        state: d.state,
      },
    });
  const done = checks.filter((c) => c.done).length;
  return {
    done,
    total: checks.length,
    percent: checks.length === 0 ? 100 : Math.floor((done / checks.length) * 100),
    missing: checks.filter((c) => !c.done).map((c) => c.gap),
  };
}
export type FileCompleteness = ReturnType<typeof fileCompleteness>;

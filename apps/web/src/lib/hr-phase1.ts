import {
  DIRECTORY_SORTS,
  type DirectorySort,
  EMPLOYEE_FLAGS,
  type EmployeeFlag,
} from '@shiplynow/shared';

// HR phase 1 (docs/HR.md "Phase 1 as built"): the file's tabs, kept in the address (?tab=), and
// the employee list's filters, sort and pages, kept in the address too.

export const FILE_TABS = [
  'overview',
  'job',
  'pay',
  'documents',
  'attendance',
  'leave',
  'violations',
  'checklists',
  'team',
  'history',
] as const;
export type FileTab = (typeof FILE_TABS)[number];

/** The tabs a person sees on a file: Pay only with the salaries switch. */
export function fileTabs(input: { canSeePay: boolean }): FileTab[] {
  return FILE_TABS.filter((k) => k !== 'pay' || input.canSeePay);
}

/** The tab asked for in the address, else Overview (a tab the person may not see too). */
export function pickTab(asked: string | undefined, tabs: readonly FileTab[]): FileTab {
  return tabs.includes(asked as FileTab) ? (asked as FileTab) : 'overview';
}

/** The organisation setup page's tabs (?tab=). */
export const ORG_TABS = ['structure', 'positions', 'grades'] as const;
export type OrgTab = (typeof ORG_TABS)[number];

/** The list's filters as they sit in the page address. */
export const LIST_KEYS = [
  'q',
  'store',
  'department',
  'status',
  'employment',
  'flag',
  'sort',
  'dir',
  'page',
] as const;
export type ListQuery = Partial<Record<(typeof LIST_KEYS)[number], string>>;

/** The API query for the list (and its CSV) from the page address; unknown values are dropped. */
export function directoryQuery(q: ListQuery, options: { page?: boolean } = {}) {
  const p = new URLSearchParams();
  if (q.q?.trim()) p.set('q', q.q.trim());
  if (q.store) p.set('darkStoreId', q.store);
  if (q.department) p.set('departmentId', q.department);
  if (q.status) p.set('status', q.status);
  if (q.employment) p.set('employment', q.employment);
  if (EMPLOYEE_FLAGS.includes(q.flag as EmployeeFlag)) p.set('flag', q.flag!);
  if (DIRECTORY_SORTS.includes(q.sort as DirectorySort)) p.set('sort', q.sort!);
  if (q.dir === 'desc') p.set('dir', 'desc');
  if (options.page !== false && q.page && /^\d+$/.test(q.page) && q.page !== '1')
    p.set('page', q.page);
  return p.toString();
}

/**
 * The list's address with some values changed. Changing anything but the page goes back to the
 * first page; undefined or '' removes a value.
 */
export function listHref(q: ListQuery, patch: ListQuery) {
  const p = new URLSearchParams();
  const resetPage = Object.keys(patch).some((k) => k !== 'page');
  for (const k of LIST_KEYS) {
    const v = k in patch ? patch[k] : k === 'page' && resetPage ? undefined : q[k];
    if (v) p.set(k, v);
  }
  if (p.get('page') === '1') p.delete('page');
  const s = p.toString();
  return s ? `/admin/hr?${s}` : '/admin/hr';
}

/** Clicking a column header: sort by it, or turn the order round when it is the sort already. */
export function sortHref(q: ListQuery, sort: DirectorySort) {
  const current = (q.sort as DirectorySort | undefined) ?? 'name';
  const dir = current === sort && q.dir !== 'desc' ? 'desc' : undefined;
  return listHref(q, { sort: sort === 'name' ? undefined : sort, dir });
}

/** The placement fields a job move changes, in the order the Job tab shows them. */
export const MOVE_FIELDS = [
  'departmentId',
  'positionId',
  'gradeId',
  'managerId',
  'homeStoreId',
  'jobTitle',
  'contractType',
  'employment',
] as const;
export type MoveField = (typeof MOVE_FIELDS)[number];

export interface HistoryRow {
  id: string;
  at: string;
  action: string;
  actor: { name: string } | null;
  before: unknown;
  after: unknown;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asText = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * The history of moves on a file (department, position, grade, manager, store, title, contract,
 * employment), newest first, from the file's audit history: one row per change with what was
 * before and after. The file's opening counts as the first placement.
 */
export function jobMoves(history: HistoryRow[]) {
  const moves: {
    id: string;
    at: string;
    by: string | null;
    opened: boolean;
    changes: { field: MoveField; from: string | null; to: string | null }[];
  }[] = [];
  for (const row of history) {
    if (!['employee.create', 'employee.update', 'employee.employment'].includes(row.action))
      continue;
    const before = asRecord(row.before);
    const after = asRecord(row.after);
    const opened = row.action === 'employee.create';
    const changes = MOVE_FIELDS.filter(
      (f) =>
        f in after && (opened ? asText(after[f]) !== null : asText(before[f]) !== asText(after[f])),
    ).map((f) => ({ field: f, from: opened ? null : asText(before[f]), to: asText(after[f]) }));
    if (changes.length)
      moves.push({ id: row.id, at: row.at, by: row.actor?.name ?? null, opened, changes });
  }
  return moves;
}

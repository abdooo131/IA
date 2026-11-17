import {
  type DocumentState,
  type ExitReason,
  isCalendarDay,
  type HireDraftData,
  type HireStep,
  type ReassignKind,
} from '@shiplynow/shared';
import type { DepartmentRow, GradeRow, PersonRef, PositionRow } from './hr-types';

// HR phase 2 (docs/HR.md "Phase 2 as built"): what the wizard and documents endpoints answer,
// and the small pure helpers the steps use (unit tested in hr-phase2.test.ts).

export interface DraftFile {
  id: string;
  kind: 'document';
  typeId: string | null;
  title: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface HireDraft {
  id: string;
  status: 'open' | 'done' | 'discarded';
  step: HireStep;
  data: HireDraftData;
  hasPay: boolean;
  employeeId: string | null;
  payPending: boolean;
  createdBy: { name: string };
  updatedAt: string;
  photoVersion: number | null;
  files: DraftFile[];
}

export interface HireDraftRow {
  id: string;
  step: HireStep;
  name: string | null;
  nameAr: string | null;
  kind: 'team' | 'rider' | null;
  hireDate: string | null;
  files: number;
  createdBy: string;
  updatedAt: string;
}

export interface PayPendingRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  hireDate: string | null;
}

export interface UploadType {
  id: string;
  nameEn: string;
  nameAr: string;
  hasExpiry: boolean;
  allowedTypes: string[];
  maxBytes: number;
  /** Shown first, one click: the person's missing or required types */
  suggested: boolean;
}

export interface RequiredDocType {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  hasExpiry: boolean;
  multiple: boolean;
  allowedTypes: string[];
  maxBytes: number;
  required: boolean;
}

export interface HireResult {
  employeeId: string;
  code: string;
  userId: string;
  setupToken: string | null;
  payPending: boolean;
  repeated: boolean;
}

export interface Settlement {
  money: boolean;
  from: string;
  daysWorked: number;
  lastMonthPayPiastres: number | null;
  leaveDaysToPay: number;
  leavePayPiastres: number | null;
  leaveDaysAhead: number;
  leaveAheadPiastres: number | null;
  unpaidLeaveDays: number;
  unpaidLeavePiastres: number | null;
  deductionCount: number;
  deductionDays: number;
  deductionsPiastres: number | null;
  advancePiastres: number | null;
  commissionPiastres: number | null;
  netPiastres: number | null;
  /** Riders paid per delivery: their wallet instead of salary figures (null without salaries) */
  riderWallet?: RiderWalletSettlement | null;
}

export interface RiderWalletSettlement {
  availablePiastres: number;
  onHoldPiastres: number;
  owedPiastres: number;
  pendingPiastres: number;
  balancePiastres: number;
}

export interface OwnedItem {
  kind: ReassignKind;
  entityId: string;
  label: string;
  labelAr: string;
}

export interface OwnerCandidates {
  people: (PersonRef & { number: number })[];
  accountManagers: { id: string; name: string }[];
  salesPeople: { id: string; name: string }[];
}

export interface LeavingPreview {
  employee: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string | null;
    status: string;
    hireDate: string | null;
    employment: string;
    contractEndsOn: string | null;
  };
  lastDay: string;
  notice: { days: number; givenDays: number | null; shortBy: number };
  items: { titleEn: string; titleAr: string; ownerRole: string }[];
  settlement: Settlement;
  owned: OwnedItem[];
  candidates: OwnerCandidates;
  blockers: { alreadyLeft: boolean; self: boolean; beforeHire: boolean; lastOwner: boolean };
}

export interface ExitView {
  id: string;
  lastDay: string;
  reason: string;
  note: string | null;
  noticeGivenOn: string | null;
  noticeDays: number;
  noticeShortBy: number;
  itemsReturned: string[];
  settlement: Settlement;
  disableAt: string;
  disabledAt: string | null;
  cancelledAt: string | null;
  reassignments: {
    id: string;
    kind: ReassignKind;
    label: string;
    newOwnerId: string | null;
    resolvedAt: string | null;
  }[];
}

export interface NeedsOwnerRow {
  id: string;
  kind: ReassignKind;
  entityId: string;
  label: string;
  createdAt: string;
  leaver: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string | null;
    lastDay: string | null;
  };
}

export interface ExpiringDocs {
  month: string;
  from: string;
  to: string;
  today: string;
  items: {
    id: string;
    day: string;
    state: DocumentState;
    type: { id: string; nameEn: string; nameAr: string };
    employee: { id: string; code: string; nameEn: string; nameAr: string | null };
  }[];
}

export interface ReminderRow {
  id: string;
  day: string;
  by: string;
  state: DocumentState;
  type: { id: string; nameEn: string; nameAr: string; selfUpload: boolean };
}

/**
 * Who may take over one thing: a person (employee) for managers and department heads, a team
 * member for merchants, deals and companies. A person never becomes their own manager.
 */
export function candidatesFor(kind: ReassignKind, c: OwnerCandidates, entityId?: string) {
  if (kind === 'manager_of' || kind === 'department_head')
    return c.people
      .filter((p) => !(kind === 'manager_of' && p.id === entityId))
      .map((p) => ({
        id: p.id,
        label: `${p.nameEn} (${p.code})`,
        labelAr: `${p.nameAr ?? p.nameEn} (${p.code})`,
      }));
  const list = kind === 'account_manager' ? c.accountManagers : c.salesPeople;
  return list.map((u) => ({ id: u.id, label: u.name, labelAr: u.name }));
}

/**
 * The calendar weeks of a month (YYYY-MM), Saturday first as Egyptian weeks run, each a row of
 * seven days (null outside the month).
 */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  // Saturday (6) is column 0.
  const lead = (firstWeekday + 1) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The month before or after (YYYY-MM). */
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The head of a department, else of the one above it, and so on: the default manager. */
export function headOfChain(departments: DepartmentRow[], departmentId: string | undefined) {
  const byId = new Map(departments.map((d) => [d.id, d]));
  let at = departmentId ? byId.get(departmentId) : undefined;
  for (let i = 0; at && i < 20; i++) {
    if (at.head) return at.head;
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return null;
}

/** The grades a position allows (every active grade without a position). */
export function gradesFor(grades: GradeRow[], position: PositionRow | undefined) {
  const active = grades.filter((g) => g.isActive).sort((a, b) => a.rank - b.rank);
  if (!position) return active;
  const lo = position.minGrade?.rank ?? -Infinity;
  const hi = position.maxGrade?.rank ?? Infinity;
  return active.filter((g) => g.rank >= lo && g.rank <= hi);
}

/** Piastres shown in an EGP box ("1250.5" → "1250.50"), empty for nothing. */
export function egpText(piastres: number | null | undefined) {
  if (piastres == null) return '';
  const whole = Math.floor(piastres / 100);
  const rest = piastres % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, '0')}`;
}

/** Which step a field's issue belongs to (the review step links back to it). */
export function stepOfField(key: string): HireStep {
  const head = key.split('.')[0];
  if (head === 'person' || head === 'job' || head === 'pay' || head === 'access') return head;
  return 'review';
}

/** The setup address a new hire opens to choose their password. */
export function setupLink(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}/setup/${token}`;
}

/** File size for people: 340 KB, 1.2 MB. */
export function fileSize(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The leaving wizard's steps. */
export const LEAVING_STEPS = ['day', 'items', 'settlement', 'owners', 'review'] as const;
export type LeavingStep = (typeof LEAVING_STEPS)[number];

/** What stops the first step: a valid last day, a reason, a note for other. */
export function leavingDayIssues(input: {
  lastDay: string;
  reason: ExitReason | '';
  note: string;
  noticeGivenOn: string;
}) {
  const out: string[] = [];
  if (!isCalendarDay(input.lastDay)) out.push('lastDay');
  if (!input.reason) out.push('reason');
  if (input.reason === 'other' && input.note.trim().length < 2) out.push('note');
  if (input.noticeGivenOn && !isCalendarDay(input.noticeGivenOn)) out.push('noticeGivenOn');
  if (input.noticeGivenOn && isCalendarDay(input.lastDay) && input.noticeGivenOn > input.lastDay)
    out.push('noticeAfter');
  return out;
}

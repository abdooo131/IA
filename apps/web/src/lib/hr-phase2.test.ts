import { hireStepIssues, hireDraftDataSchema, hireSteps, nextHireStep } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import {
  candidatesFor,
  egpText,
  fileSize,
  gradesFor,
  headOfChain,
  leavingDayIssues,
  monthGrid,
  setupLink,
  shiftMonth,
  stepOfField,
} from './hr-phase2';
import type { DepartmentRow, GradeRow, PositionRow } from './hr-types';

const person = (id: string) => ({ id, code: 'EMP-0001', nameEn: id, nameAr: null });
const dept = (id: string, parentId: string | null, head: string | null): DepartmentRow => ({
  id,
  code: id,
  nameEn: id,
  nameAr: id,
  parentId,
  sort: 0,
  isActive: true,
  head: head ? person(head) : null,
  costStore: null,
  members: 0,
  positions: 0,
});
const grade = (id: string, rank: number): GradeRow => ({
  id,
  code: id,
  nameEn: id,
  nameAr: id,
  rank,
  bandMinPiastres: null,
  bandMaxPiastres: null,
  annualLeaveDays: null,
  isActive: true,
  people: 0,
});

describe('hire wizard steps', () => {
  it('walks the steps and stops on what each one needs', () => {
    const data = hireDraftDataSchema.parse({ person: { nameEn: 'Mona' } });
    const steps = hireSteps({ canPay: false });
    expect(hireStepIssues(data, 'person', { today: '2026-11-07', steps })).toEqual({
      'person.mobile': 'required',
    });
    expect(nextHireStep(steps, 'job', 1)).toBe('documents');
    expect(stepOfField('person.mobile')).toBe('person');
    expect(stepOfField('access.jobRole')).toBe('access');
    expect(stepOfField('other')).toBe('review');
  });

  it('defaults the manager from the department head chain and limits grades', () => {
    const tree = [dept('ops', null, 'boss'), dept('ds', 'ops', null), dept('rid', 'ops', 'lead')];
    expect(headOfChain(tree, 'ds')?.id).toBe('boss');
    expect(headOfChain(tree, 'rid')?.id).toBe('lead');
    expect(headOfChain(tree, undefined)).toBeNull();
    const grades = [grade('junior', 2), grade('intern', 1), grade('lead', 5), grade('mid', 3)];
    const position = {
      minGrade: { rank: 2 },
      maxGrade: { rank: 3 },
    } as unknown as PositionRow;
    expect(gradesFor(grades, position).map((g) => g.id)).toEqual(['junior', 'mid']);
    expect(gradesFor(grades, undefined).map((g) => g.id)).toEqual([
      'intern',
      'junior',
      'mid',
      'lead',
    ]);
  });

  it('shows piastres in EGP boxes and file sizes', () => {
    expect(egpText(900_000)).toBe('9000');
    expect(egpText(125_050)).toBe('1250.50');
    expect(egpText(null)).toBe('');
    expect(fileSize(340_000)).toBe('340 KB');
    expect(fileSize(1_234_567)).toBe('1.2 MB');
    expect(setupLink('https://app.shiply.eg/', 'abc')).toBe('https://app.shiply.eg/setup/abc');
  });
});

describe('leaving wizard', () => {
  it('needs a last day, a reason, a note for other and a notice before the last day', () => {
    expect(
      leavingDayIssues({ lastDay: '2026-11-30', reason: '', note: '', noticeGivenOn: '' }),
    ).toEqual(['reason']);
    expect(
      leavingDayIssues({ lastDay: 'x', reason: 'other', note: '', noticeGivenOn: '2026-12-01' }),
    ).toEqual(['lastDay', 'note']);
    expect(
      leavingDayIssues({
        lastDay: '2026-11-30',
        reason: 'resignation',
        note: '',
        noticeGivenOn: '2026-12-01',
      }),
    ).toEqual(['noticeAfter']);
  });

  it('offers people for managers and team members for merchants and deals', () => {
    const c = {
      people: [{ id: 'e1', code: 'EMP-0001', number: 1, nameEn: 'Ali', nameAr: 'علي' }],
      accountManagers: [{ id: 'u1', name: 'Mona' }],
      salesPeople: [{ id: 'u2', name: 'Sara' }],
    };
    expect(candidatesFor('manager_of', c)).toEqual([
      { id: 'e1', label: 'Ali (EMP-0001)', labelAr: 'علي (EMP-0001)' },
    ]);
    // Nobody is offered as their own manager.
    expect(candidatesFor('manager_of', c, 'e1')).toEqual([]);
    expect(candidatesFor('department_head', c, 'e1')).toHaveLength(1);
    expect(candidatesFor('account_manager', c).map((x) => x.id)).toEqual(['u1']);
    expect(candidatesFor('deal_owner', c).map((x) => x.id)).toEqual(['u2']);
  });
});

describe('expiry calendar', () => {
  it('lays a month out in Saturday first weeks', () => {
    // November 2026 starts on a Sunday: one empty Saturday first.
    const weeks = monthGrid('2026-11');
    expect(weeks[0]).toEqual([
      null,
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // August 2026 starts on a Saturday: no empty day first.
    expect(monthGrid('2026-08')[0]![0]).toBe('2026-08-01');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

import { describe, expect, it } from 'vitest';
import { directoryQuery, fileTabs, jobMoves, listHref, pickTab, sortHref } from './hr-phase1';

describe('file tabs', () => {
  it('shows Pay only with the salaries switch and falls back to Overview', () => {
    expect(fileTabs({ canSeePay: true })).toEqual([
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
    ]);
    const tabs = fileTabs({ canSeePay: false });
    expect(tabs).not.toContain('pay');
    expect(pickTab('pay', tabs)).toBe('overview');
    expect(pickTab('leave', tabs)).toBe('leave');
    expect(pickTab(undefined, tabs)).toBe('overview');
    expect(pickTab('nope', tabs)).toBe('overview');
  });
});

describe('job moves', () => {
  it('lists placement changes from the file history, newest first, and skips the rest', () => {
    const moves = jobMoves([
      {
        id: 'h3',
        at: '2026-11-03T10:00:00Z',
        action: 'employee.update',
        actor: { name: 'HR' },
        before: { departmentId: 'd1', gradeId: 'g1', address: 'Old', nationalId: null },
        after: { departmentId: 'd2', gradeId: 'g1', address: 'New', nationalId: '1' },
      },
      {
        id: 'h2',
        at: '2026-11-02T10:00:00Z',
        action: 'employee.employment',
        actor: null,
        before: { employment: 'employee' },
        after: { employment: 'outsourced' },
      },
      {
        id: 'hx',
        at: '2026-11-02T09:00:00Z',
        action: 'employee.update',
        actor: { name: 'HR' },
        before: { address: 'a' },
        after: { address: 'b' },
      },
      {
        id: 'h1',
        at: '2026-11-01T10:00:00Z',
        action: 'employee.create',
        actor: { name: 'Owner' },
        before: null,
        after: { departmentId: 'd1', positionId: null, gradeId: 'g1' },
      },
      {
        id: 'h0',
        at: '2026-11-01T09:00:00Z',
        action: 'user.create',
        actor: null,
        before: null,
        after: {},
      },
    ]);
    expect(moves).toEqual([
      {
        id: 'h3',
        at: '2026-11-03T10:00:00Z',
        by: 'HR',
        opened: false,
        changes: [{ field: 'departmentId', from: 'd1', to: 'd2' }],
      },
      {
        id: 'h2',
        at: '2026-11-02T10:00:00Z',
        by: null,
        opened: false,
        changes: [{ field: 'employment', from: 'employee', to: 'outsourced' }],
      },
      {
        id: 'h1',
        at: '2026-11-01T10:00:00Z',
        by: 'Owner',
        opened: true,
        changes: [
          { field: 'departmentId', from: null, to: 'd1' },
          { field: 'gradeId', from: null, to: 'g1' },
        ],
      },
    ]);
  });
});

describe('employee list address', () => {
  it('turns the page address into the API query, dropping unknown values', () => {
    expect(
      directoryQuery({
        q: ' Mona ',
        store: 's1',
        department: 'd1',
        status: 'active',
        employment: 'outsourced',
        flag: 'on_probation',
        sort: 'hired',
        dir: 'desc',
        page: '3',
      }),
    ).toBe(
      'q=Mona&darkStoreId=s1&departmentId=d1&status=active&employment=outsourced&flag=on_probation&sort=hired&dir=desc&page=3',
    );
    expect(directoryQuery({ flag: 'nope', sort: 'nope', dir: 'up', page: 'x' })).toBe('');
    expect(directoryQuery({ page: '2', q: 'a' }, { page: false })).toBe('q=a');
  });

  it('goes back to the first page when a filter changes, and keeps it for paging', () => {
    const q = { q: 'a', page: '3', sort: 'code' };
    expect(listHref(q, { flag: 'left' })).toBe('/admin/hr?q=a&flag=left&sort=code');
    expect(listHref(q, { page: '4' })).toBe('/admin/hr?q=a&sort=code&page=4');
    expect(listHref(q, { page: '1' })).toBe('/admin/hr?q=a&sort=code');
    expect(listHref({}, {})).toBe('/admin/hr');
  });

  it('sorts by a column, then turns the order round', () => {
    expect(sortHref({}, 'hired')).toBe('/admin/hr?sort=hired');
    expect(sortHref({ sort: 'hired' }, 'hired')).toBe('/admin/hr?sort=hired&dir=desc');
    expect(sortHref({ sort: 'hired', dir: 'desc' }, 'hired')).toBe('/admin/hr?sort=hired');
    expect(sortHref({ sort: 'hired' }, 'name')).toBe('/admin/hr');
    expect(sortHref({}, 'name')).toBe('/admin/hr?dir=desc');
  });
});

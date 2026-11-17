import { tenure } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import {
  departmentOptions,
  type DepartmentRow,
  employeeCodeOf,
  photoUrl,
  titleOf,
} from './hr-types';

const dept = (id: string, parentId: string | null, isActive = true) =>
  ({ id, parentId, isActive, code: id, nameEn: id, nameAr: id }) as DepartmentRow;

describe('hr helpers', () => {
  it('lists departments in tree order with their depth, leaving closed ones out', () => {
    const rows = [
      dept('ops-ds', 'ops'),
      dept('mgt', null),
      dept('ops', 'mgt'),
      dept('fin', 'mgt'),
      dept('old', 'mgt', false),
    ];
    expect(departmentOptions(rows).map(({ d, depth }) => `${d.id}:${depth}`)).toEqual([
      'mgt:0',
      'ops:1',
      'ops-ds:2',
      'fin:1',
    ]);
  });

  it('builds photo addresses, codes, titles and tenure', () => {
    expect(photoUrl('e1', null)).toBeNull();
    expect(photoUrl('e1', 42)).toBe('/api/people/e1/photo?v=42');
    expect(employeeCodeOf(7)).toBe('EMP-0007');
    expect(titleOf({ titleEn: 'Rider', titleAr: 'مندوب' }, 'ar')).toBe('مندوب');
    expect(titleOf({ titleEn: 'Rider', titleAr: null }, 'ar')).toBe('Rider');
    expect(tenure('2024-03-15', '2026-11-06')).toEqual({ years: 2, months: 7 });
    expect(tenure('2026-11-01', '2026-11-06')).toEqual({ years: 0, months: 0 });
  });
});

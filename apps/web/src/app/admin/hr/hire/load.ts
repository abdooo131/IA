import { cairoDay, canDo, HIRE_STEPS, type HireStep } from '@shiplynow/shared';
import type { HireGrant, HireLookups } from '@/components/hr/hire/HireWizard';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ShiftRow } from '@/lib/attendance-types';
import type { SettingsList } from '@/lib/dashboard-types';
import type {
  DepartmentRow,
  DocumentTypeRow,
  EmployeeRow,
  GradeRow,
  PositionRow,
} from '@/lib/hr-types';

/** What both hire wizard pages read: the lookups, what the person may give, and settings. */
export async function loadHireWizard() {
  const [
    stores,
    departments,
    positions,
    grades,
    suppliers,
    shifts,
    people,
    types,
    settings,
    profile,
  ] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<DepartmentRow[]>('/hr/departments'),
    apiGet<PositionRow[]>('/hr/positions'),
    apiGet<GradeRow[]>('/hr/grades'),
    apiGet<{ id: string; name: string }[]>('/hr/staffing-companies'),
    apiGet<ShiftRow[]>('/hr/shifts'),
    apiGet<EmployeeRow[]>('/hr/employees?status=active'),
    apiGet<DocumentTypeRow[]>('/hr/document-types'),
    apiGet<SettingsList>('/admin/settings'),
    getMyProfile(),
  ]);
  const lookups: HireLookups = {
    stores,
    departments,
    positions,
    grades,
    suppliers,
    shifts,
    people,
    documentTypes: types,
  };
  const grant: HireGrant = {
    canPay: Boolean(profile?.salaries),
    settings: canDo(profile, 'settings', 'manage'),
    salaries: Boolean(profile?.salaries),
    customerData: Boolean(profile?.customerData),
    allStores: Boolean(profile?.allStores),
    storeIds: profile?.storeIds ?? [],
  };
  const months = settings.settings.find((s) => s.key === 'hr.probation_months');
  return {
    lookups,
    grant,
    canUse: canDo(profile, 'hr', 'use'),
    probationMonths: Number(months?.global ?? months?.default ?? 3),
    today: cairoDay(new Date()),
  };
}

/** The step in the address when it is one, else the draft's own. */
export function pickStep(asked: string | undefined, fallback: HireStep): HireStep {
  return (HIRE_STEPS as readonly string[]).includes(asked ?? '') ? (asked as HireStep) : fallback;
}

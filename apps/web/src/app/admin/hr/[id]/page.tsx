import { cairoDay, canDo } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { DocumentsPanel } from '@/components/hr/DocumentsPanel';
import { EmployeeForm } from '@/components/hr/EmployeeForm';
import { EmployeeStatusPanel } from '@/components/hr/EmployeeStatusPanel';
import { StatusChip } from '@/components/hr/StatusChip';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import {
  type EmployeeDocument,
  type EmployeeFile,
  type EmployeeRow,
  employeeName,
} from '@/lib/hr-types';

export const dynamic = 'force-dynamic';
const TABS = ['details', 'documents', 'history'] as const;
type Tab = (typeof TABS)[number];

/** One employee file: Details, Documents and History tabs. */
export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const asked = (await searchParams).tab;
  const tab: Tab = TABS.includes(asked as Tab) ? (asked as Tab) : 'details';
  const [file, profile, t, tu, locale] = await Promise.all([
    apiGet<EmployeeFile>(`/hr/employees/${id}`),
    getMyProfile(),
    getTranslations('hr'),
    getTranslations('admin.users'),
    getLocale(),
  ]);
  const today = cairoDay(new Date());
  const canUse = canDo(profile, 'hr', 'use');
  const canManage = canDo(profile, 'hr', 'manage');
  const tabClass = (active: boolean) =>
    `flex h-10 items-center rounded-pill border px-4 text-body-sm font-bold ${
      active ? 'border-transparent bg-selected-bg text-link' : 'border-line bg-surface text-text'
    }`;

  return (
    <>
      <Link href="/admin/hr" className="text-body-sm text-link">
        {t('back')}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-h2">{employeeName(file, locale)}</h1>
        <StatusChip status={file.status} label={t(`statuses.${file.status}`)} />
      </div>
      <p className="mt-1 text-body-sm text-text-muted">
        <span className="ltr-iso">{file.code}</span>
        {' · '}
        {t(`roles.${file.user.role}`)}
        {file.user.jobRole && <> · {tu(`jobRoles.${file.user.jobRole}`)}</>}
        {' · '}
        <span className="ltr-iso">{file.user.email}</span>
        {!file.user.isActive && <> · {t('accountDisabled')}</>}
      </p>
      {file.status === 'left' && file.leftOn && (
        <p className="mt-1 text-body-sm text-danger">
          {t('leftOnReason', { date: isoToDayFirst(file.leftOn), reason: file.leftReason ?? '' })}
        </p>
      )}

      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('tabsLabel')}>
        {TABS.map((k) => (
          <Link
            key={k}
            href={`/admin/hr/${id}?tab=${k}`}
            aria-current={tab === k ? 'page' : undefined}
            className={tabClass(tab === k)}
          >
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>

      {tab === 'details' && (
        <DetailsTab
          file={file}
          canUse={canUse}
          canManage={canManage}
          payroll={canDo(profile, 'accounting', 'view')}
          today={today}
        />
      )}
      {tab === 'documents' && (
        <DocumentsTab id={id} canUse={canUse} canManage={canManage} today={today} />
      )}
      {tab === 'history' && (
        <RecordHistory entityType="employee" entityId={id} path={`/hr/employees/${id}/history`} />
      )}
    </>
  );
}

async function DetailsTab({
  file,
  canUse,
  canManage,
  payroll,
  today,
}: {
  file: EmployeeFile;
  canUse: boolean;
  canManage: boolean;
  payroll: boolean;
  today: string;
}) {
  const [stores, people, t] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<EmployeeRow[]>('/hr/employees?status=active'),
    getTranslations('hr'),
  ]);
  return (
    <>
      {file.salary !== undefined && file.canSeePay && (
        <p className="mt-4 max-w-3xl rounded-md bg-surface-raised px-3 py-2 text-body-sm">
          {file.salary
            ? t('salaryLine', { amount: formatEgp(file.salary.monthlyPiastres) })
            : t('noSalary')}{' '}
          {payroll && (
            <Link href="/finance/payroll" className="font-bold text-link">
              {t('openPayroll')}
            </Link>
          )}
        </p>
      )}
      <EmployeeForm file={file} stores={stores} managers={people} canEdit={canUse} />
      {canManage && <EmployeeStatusPanel employeeId={file.id} status={file.status} today={today} />}
    </>
  );
}

async function DocumentsTab({
  id,
  canUse,
  canManage,
  today,
}: {
  id: string;
  canUse: boolean;
  canManage: boolean;
  today: string;
}) {
  const documents = await apiGet<EmployeeDocument[]>(`/hr/employees/${id}/documents`);
  return (
    <DocumentsPanel
      documents={documents}
      downloadBase={`/api/hr/employees/${id}/documents`}
      employeeId={canUse ? id : undefined}
      canDelete={canManage}
      today={today}
    />
  );
}

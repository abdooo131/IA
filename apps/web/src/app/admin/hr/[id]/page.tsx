import { cairoDay, canDo } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChecklistsPanel } from '@/components/hr/ChecklistsPanel';
import { CompletenessBar, DocumentsPanel, StateChip } from '@/components/hr/DocumentsPanel';
import { EmployeeForm } from '@/components/hr/EmployeeForm';
import { EmployeeHeader } from '@/components/hr/EmployeeHeader';
import { EmployeeStatusPanel } from '@/components/hr/EmployeeStatusPanel';
import { EmploymentPanel, SalaryPackagePanel } from '@/components/hr/PayPanels';
import { PhotoEditor } from '@/components/hr/PhotoEditor';
import { TeamPanel } from '@/components/hr/TeamPanel';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import type {
  ChecklistTemplateRow,
  DepartmentRow,
  DocumentChecklist,
  DocumentTypeRow,
  EmployeeChecklist,
  EmployeeDocument,
  EmployeeFile,
  EmployeeRow,
  GradeRow,
  PositionRow,
  SalaryPackage,
  TeamData,
} from '@/lib/hr-types';

export const dynamic = 'force-dynamic';
const TABS = ['overview', 'job', 'pay', 'documents', 'checklists', 'team', 'history'] as const;
type Tab = (typeof TABS)[number];

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h3">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-body-sm">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 text-end font-bold">{children ?? '–'}</dd>
    </div>
  );
}

/**
 * One employee file, Odoo style: a profile header (photo, names, position, grade, department,
 * manager, status, tenure) and tabs for the overview, job and contract, salary package (with
 * the salaries switch), documents, onboarding checklists, team and history.
 */
export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const asked = (await searchParams).tab;
  const [file, profile, t, th] = await Promise.all([
    apiGet<EmployeeFile>(`/hr/employees/${id}`),
    getMyProfile(),
    getTranslations('people'),
    getTranslations('hr'),
  ]);
  const tabs = TABS.filter((k) => k !== 'pay' || file.canSeePay);
  const tab: Tab = tabs.includes(asked as Tab) ? (asked as Tab) : 'overview';
  const canUse = canDo(profile, 'hr', 'use');
  const canManage = canDo(profile, 'hr', 'manage');
  const tabClass = (current: boolean) =>
    `flex h-10 shrink-0 items-center border-b-2 px-3 text-body-sm font-bold ${
      current ? 'border-primary text-link' : 'border-transparent text-text-muted hover:text-text'
    }`;

  return (
    <>
      <Link href="/admin/hr" className="text-body-sm text-link">
        {th('back')}
      </Link>
      <div className="mt-2">
        <EmployeeHeader
          file={file}
          managerHref={(m) => `/admin/hr/${m}`}
          photo={
            <PhotoEditor
              employeeId={file.id}
              photoVersion={file.photoVersion}
              name={file.nameEn}
              uploadPath={canUse ? `/hr/employees/${file.id}/photo` : undefined}
              deletePath={canUse ? `/hr/employees/${file.id}/photo` : undefined}
            />
          }
        />
      </div>

      <nav
        className="mt-4 flex gap-1 overflow-x-auto border-b border-line"
        aria-label={th('tabsLabel')}
      >
        {tabs.map((k) => (
          <Link
            key={k}
            href={`/admin/hr/${id}?tab=${k}`}
            aria-current={tab === k ? 'page' : undefined}
            className={tabClass(tab === k)}
          >
            {t(`tabs.${k}`)}
            {k === 'team' && file.team && file.team.total > 0 && (
              <span className="ltr-iso ms-1.5 rounded-pill bg-surface-raised px-1.5 text-caption">
                {file.team.total}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && (
        <OverviewTab file={file} canManage={canManage} today={cairoDay(new Date())} />
      )}
      {tab === 'job' && <JobTab file={file} canUse={canUse} />}
      {tab === 'pay' && (
        <PayTab
          file={file}
          canEdit={canUse}
          payroll={canDo(profile, 'accounting', 'view') ? '/finance/payroll' : null}
        />
      )}
      {tab === 'documents' && <DocumentsTab id={id} canUse={canUse} canManage={canManage} />}
      {tab === 'checklists' && <ChecklistsTab id={id} canUse={canUse} canManage={canManage} />}
      {tab === 'team' && <TeamTab id={id} />}
      {tab === 'history' && (
        <RecordHistory entityType="employee" entityId={id} path={`/hr/employees/${id}/history`} />
      )}
    </>
  );
}

async function OverviewTab({
  file,
  canManage,
  today,
}: {
  file: EmployeeFile;
  canManage: boolean;
  today: string;
}) {
  const [docs, lists, t, th] = await Promise.all([
    apiGet<{ checklist: DocumentChecklist }>(`/hr/employees/${file.id}/documents`),
    apiGet<EmployeeChecklist[]>(`/hr/employees/${file.id}/checklists`),
    getTranslations('people'),
    getTranslations('hr'),
  ]);
  const locale = await getLocale();
  const day = (d: string | null) =>
    d ? <span className="ltr-iso">{isoToDayFirst(d)}</span> : null;
  const open = lists.filter((c) => c.status === 'open');
  const todo = docs.checklist.items.filter((i) => i.required && i.state !== 'verified');
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card title={t('contact')}>
        <dl>
          <Row label={th('fields.mobile')}>
            {file.mobile && <span className="ltr-iso">{file.mobile}</span>}
          </Row>
          <Row label={t('email')}>
            <span className="ltr-iso break-all">{file.user.email}</span>
          </Row>
          <Row label={th('fields.emergencyName')}>{file.emergencyName}</Row>
          <Row label={th('fields.emergencyPhone')}>
            {file.emergencyPhone && <span className="ltr-iso">{file.emergencyPhone}</span>}
          </Row>
          <Row label={th('fields.address')}>{file.address}</Row>
        </dl>
      </Card>
      <Card title={t('contractCard')}>
        <dl>
          <Row label={t('employment')}>
            {file.employment === 'outsourced'
              ? t('outsourcedVia', { company: file.staffingSupplier?.name ?? '–' })
              : t('employments.employee')}
          </Row>
          <Row label={th('fields.contractType')}>{th(`contractTypes.${file.contractType}`)}</Row>
          <Row label={th('fields.hireDate')}>{day(file.hireDate)}</Row>
          <Row label={th('fields.contractEndsOn')}>{day(file.contractEndsOn)}</Row>
          <Row label={th('fields.probationEndsOn')}>
            {file.probationEndsOn && (
              <span
                className={file.probationEndsOn >= today ? 'text-status-needs-action' : undefined}
              >
                {isoToDayFirst(file.probationEndsOn)}
              </span>
            )}
          </Row>
          {file.salary && (
            <Row label={t('gross')}>
              <span className="ltr-iso">{formatEgp(file.salary.grossPiastres)}</span>
            </Row>
          )}
        </dl>
      </Card>
      <Card
        title={t('tabs.documents')}
        action={
          <Link
            href={`/admin/hr/${file.id}?tab=documents`}
            className="text-body-sm font-bold text-link"
          >
            {t('open')}
          </Link>
        }
      >
        <CompletenessBar
          percent={docs.checklist.percent}
          done={docs.checklist.done}
          required={docs.checklist.required}
        />
        {todo.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {todo.map((i) => (
              <li key={i.type.id} className="flex items-center justify-between gap-2 text-body-sm">
                <span className="truncate">{locale === 'ar' ? i.type.nameAr : i.type.nameEn}</span>
                <StateChip state={i.state} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title={t('tabs.checklists')}
        action={
          <Link
            href={`/admin/hr/${file.id}?tab=checklists`}
            className="text-body-sm font-bold text-link"
          >
            {t('open')}
          </Link>
        }
      >
        {open.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noOpenChecklist')}</p>
        ) : (
          <ul className="space-y-3">
            {open.map((c) => (
              <li key={c.id}>
                <div className="flex justify-between text-body-sm">
                  <span className="font-bold">{locale === 'ar' ? c.nameAr : c.nameEn}</span>
                  <span className="ltr-iso">
                    {c.done}/{c.total}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-raised">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${c.total ? Math.round((c.done / c.total) * 100) : 0}%` }}
                  />
                </div>
                {c.tasks.some((x) => x.overdue) && (
                  <p className="mt-1 text-caption text-danger">
                    {t('lateTasks', { count: c.tasks.filter((x) => x.overdue).length })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('identity')}>
        <dl>
          <Row label={th('fields.nameEn')}>{file.nameEn}</Row>
          <Row label={th('fields.nameAr')}>{file.nameAr}</Row>
          <Row label={th('fields.nationalId')}>
            {file.nationalId && <span className="ltr-iso">{file.nationalId}</span>}
          </Row>
          <Row label={th('fields.birthDate')}>{day(file.birthDate)}</Row>
          <Row label={th('fields.socialInsuranceNumber')}>{file.socialInsuranceNumber}</Row>
        </dl>
      </Card>
      <Card title={t('tabs.team')}>
        <p className="text-body-sm">
          {file.team && file.team.total > 0
            ? t('teamLine', { direct: file.team.direct, total: file.team.total })
            : t('teamEmpty')}
        </p>
        {file.managerSource === 'department' && file.effectiveManager && (
          <p className="mt-2 text-caption text-text-muted">{t('managerFromChain')}</p>
        )}
      </Card>
      {canManage && (
        <div className="lg:col-span-3">
          <EmployeeStatusPanel employeeId={file.id} status={file.status} today={today} />
        </div>
      )}
    </div>
  );
}

async function JobTab({ file, canUse }: { file: EmployeeFile; canUse: boolean }) {
  const [stores, people, departments, positions, grades, suppliers] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<EmployeeRow[]>('/hr/employees?status=active'),
    apiGet<DepartmentRow[]>('/hr/departments'),
    apiGet<PositionRow[]>('/hr/positions'),
    apiGet<GradeRow[]>('/hr/grades'),
    apiGet<{ id: string; name: string }[]>('/hr/staffing-companies'),
  ]);
  return (
    <div className="mt-4 max-w-3xl space-y-4">
      <EmploymentPanel file={file} suppliers={suppliers} canEdit={canUse} />
      <EmployeeForm
        file={file}
        stores={stores}
        managers={people}
        departments={departments}
        positions={positions}
        grades={grades.filter((g) => g.isActive)}
        canEdit={canUse}
      />
    </div>
  );
}

async function PayTab({
  file,
  canEdit,
  payroll,
}: {
  file: EmployeeFile;
  canEdit: boolean;
  payroll: string | null;
}) {
  const pkg = await apiGet<{ history: SalaryPackage[] }>(`/hr/employees/${file.id}/package`);
  return (
    <SalaryPackagePanel file={file} history={pkg.history} canEdit={canEdit} payrollHref={payroll} />
  );
}

async function DocumentsTab({
  id,
  canUse,
  canManage,
}: {
  id: string;
  canUse: boolean;
  canManage: boolean;
}) {
  const [data, types] = await Promise.all([
    apiGet<{ checklist: DocumentChecklist; documents: EmployeeDocument[] }>(
      `/hr/employees/${id}/documents`,
    ),
    apiGet<DocumentTypeRow[]>('/hr/document-types'),
  ]);
  return (
    <DocumentsPanel
      checklist={data.checklist}
      documents={data.documents}
      types={canUse ? types : []}
      mode={{ kind: 'hr', employeeId: id, canUse, canManage }}
    />
  );
}

async function ChecklistsTab({
  id,
  canUse,
  canManage,
}: {
  id: string;
  canUse: boolean;
  canManage: boolean;
}) {
  const [lists, templates] = await Promise.all([
    apiGet<EmployeeChecklist[]>(`/hr/employees/${id}/checklists`),
    apiGet<ChecklistTemplateRow[]>('/hr/checklist-templates'),
  ]);
  return (
    <ChecklistsPanel
      employeeId={id}
      checklists={lists}
      templates={templates}
      canUse={canUse}
      canManage={canManage}
    />
  );
}

async function TeamTab({ id }: { id: string }) {
  const team = await apiGet<TeamData>(`/hr/employees/${id}/team`);
  return <TeamPanel team={team} hrefBase="/admin/hr" />;
}

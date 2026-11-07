import { addDays, cairoDay, canDo, type FileCompleteness } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AttendancePill } from '@/components/hr/AttendancePill';
import { ChecklistsPanel } from '@/components/hr/ChecklistsPanel';
import { DocumentsPanel, StateChip } from '@/components/hr/DocumentsPanel';
import { EmployeeForm } from '@/components/hr/EmployeeForm';
import { EmployeeHeader } from '@/components/hr/EmployeeHeader';
import { EmployeeStatusPanel } from '@/components/hr/EmployeeStatusPanel';
import { FlagChip } from '@/components/hr/FlagChip';
import { btnPrimary, btnSecondary, EmptyState, TabLinks } from '@/components/hr/HrPage';
import { EmploymentPanel, PayBasisPanel, SalaryPackagePanel } from '@/components/hr/PayPanels';
import { PhotoEditor } from '@/components/hr/PhotoEditor';
import { SetupLinkButton } from '@/components/hr/SetupLinkButton';
import { TeamPanel } from '@/components/hr/TeamPanel';
import { BalanceCards } from '@/components/hr/leave/MyLeaveView';
import { LeaveRequestForm } from '@/components/hr/leave/LeaveRequestForm';
import { LeaveRequestsTable } from '@/components/hr/leave/LeaveRequestsTable';
import { RecordViolationForm } from '@/components/hr/leave/RecordViolationForm';
import { ViolationsTable } from '@/components/hr/leave/ViolationsTable';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { cairoHm, type DayDetail, type DayListRow, hours } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import type { FileExtras } from '@/lib/hr-overview-types';
import { type FileTab, fileTabs, type HistoryRow, jobMoves, pickTab } from '@/lib/hr-phase1';
import {
  type ChecklistTemplateRow,
  type DepartmentRow,
  type DocumentChecklist,
  type DocumentTypeRow,
  type EmployeeChecklist,
  type EmployeeDocument,
  type EmployeeFile,
  employeeName,
  type EmployeeRow,
  type GradeRow,
  type PositionRow,
  type SalaryPackage,
  type TeamData,
} from '@/lib/hr-types';
import type { EmployeeLeave, LeaveType, Violation, ViolationType } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

type File = EmployeeFile & FileExtras;

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
    <section className="min-w-0 rounded-lg border border-line bg-surface p-4">
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

/** WhatsApp wants the number with its country code and no plus. */
const whatsapp = (mobile: string) => `https://wa.me/${mobile.replace(/\D/g, '')}`;

/**
 * One employee file (HR phase 1): a header with the person, their manager, department, store,
 * status and quick actions; a bar of how complete the file is with exactly what is missing;
 * and tabs kept in the address (?tab=): Overview, Job, Pay (salaries switch), Documents,
 * Attendance, Leave, Violations, Checklists, Team and History.
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
    apiGet<File>(`/hr/employees/${id}`),
    getMyProfile(),
    getTranslations('hr1'),
    getTranslations('hr'),
  ]);
  const tabs = fileTabs({ canSeePay: !!file.canSeePay });
  const tab: FileTab = pickTab(asked, tabs);
  const canUse = canDo(profile, 'hr', 'use');
  const canManage = canDo(profile, 'hr', 'manage');
  const href = (k: FileTab, anchor = '') => `/admin/hr/${id}?tab=${k}${anchor}`;
  const gone = file.status === 'left';

  const actions = (
    <>
      {file.mobile && (
        <>
          <a href={`tel:${file.mobile}`} className={btnSecondary}>
            {t('file.call')}
          </a>
          <a href={whatsapp(file.mobile)} target="_blank" rel="noreferrer" className={btnSecondary}>
            {t('file.whatsapp')}
          </a>
        </>
      )}
      {canUse && (
        <Link href={href('documents', '#upload')} className={btnSecondary}>
          {t('file.uploadDocument')}
        </Link>
      )}
      {canUse && !gone && (
        <Link href={href('leave', '#ask')} className={btnSecondary}>
          {t('file.requestLeave')}
        </Link>
      )}
      {canUse && !gone && (
        <Link href={href('violations', '#record')} className={btnSecondary}>
          {t('file.recordViolation')}
        </Link>
      )}
      {canManage && (
        <Link href={href('overview', '#status')} className={btnSecondary}>
          {t('file.changeStatus')}
        </Link>
      )}
      {canManage && !gone && (
        <Link href={`/admin/hr/${id}/leaving`} className={btnSecondary}>
          {t('file.startLeaving')}
        </Link>
      )}
      {canUse && (
        <Link href={href('job', '#edit')} className={btnPrimary}>
          {t('file.edit')}
        </Link>
      )}
    </>
  );

  return (
    <>
      <Link href="/admin/hr" className="text-body-sm text-link">
        {t('file.back')}
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
      <div className="mt-3 flex flex-wrap gap-2" aria-label={t('file.quickActions')}>
        {actions}
      </div>
      {file.flags.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {file.flags.map((f) => (
            <FlagChip key={f} flag={f} label={t(`flags.${f}`)} />
          ))}
        </p>
      )}

      {file.login === 'pending' && !gone && (
        <SetupLinkButton employeeId={file.id} canUse={canUse} />
      )}
      {file.exit && !file.exit.disabledAt && !file.exit.cancelledAt && gone && (
        <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-body-sm">
          {t('file.accountClosesOn', { date: isoToDayFirst(file.exit.lastDay) })}
        </p>
      )}

      <CompletenessPanel c={file.fileCompleteness} href={href} canUse={canUse} />

      <TabLinks
        tabs={tabs}
        current={tab}
        href={(k) => href(k)}
        label={(k) => t(`tabs.${k}`)}
        ariaLabel={th('tabsLabel')}
        counts={{ team: file.team?.total ?? 0, violations: file.openViolations }}
      />

      {tab === 'overview' && <OverviewTab file={file} canManage={canManage} />}
      {tab === 'job' && <JobTab file={file} canUse={canUse} />}
      {tab === 'pay' && (
        <PayTab
          file={file}
          canEdit={canUse}
          payroll={canDo(profile, 'accounting', 'view') ? '/finance/payroll' : null}
        />
      )}
      {tab === 'documents' && <DocumentsTab id={id} canUse={canUse} canManage={canManage} />}
      {tab === 'attendance' && <AttendanceTab file={file} />}
      {tab === 'leave' && <LeaveTab file={file} canUse={canUse && !gone} />}
      {tab === 'violations' && <ViolationsTab file={file} canUse={canUse && !gone} />}
      {tab === 'checklists' && <ChecklistsTab id={id} canUse={canUse} canManage={canManage} />}
      {tab === 'team' && <TeamTab id={id} />}
      {tab === 'history' && (
        <RecordHistory entityType="employee" entityId={id} path={`/hr/employees/${id}/history`} />
      )}
    </>
  );
}

/** "File 80% complete" and exactly what is missing, each with where to fix it. */
async function CompletenessPanel({
  c,
  href,
  canUse,
}: {
  c: FileCompleteness;
  href: (tab: FileTab, anchor?: string) => string;
  canUse: boolean;
}) {
  const [t, locale] = await Promise.all([getTranslations('hr1'), getLocale()]);
  const tone =
    c.percent === 100
      ? 'bg-status-delivered'
      : c.percent >= 50
        ? 'bg-status-needs-action'
        : 'bg-danger';
  return (
    <section
      className="mt-4 rounded-lg border border-line bg-surface p-4"
      aria-labelledby="complete"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="complete" className="text-body font-bold">
          {t('file.complete', { percent: c.percent })}
        </h2>
        <span className="ltr-iso text-caption text-text-muted">
          {c.done}/{c.total}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-raised"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={c.percent}
        aria-labelledby="complete"
      >
        <div className={`h-full ${tone}`} style={{ width: `${c.percent}%` }} />
      </div>
      {c.missing.length > 0 && (
        <>
          <p className="mt-3 text-caption text-text-muted">{t('file.missingIntro')}</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {c.missing.map((m) => {
              const label =
                m.kind === 'field'
                  ? t(`fields.${m.field}`)
                  : `${locale === 'ar' ? m.nameAr : m.nameEn} · ${t(`docStates.${m.state}`)}`;
              // Documents are added on their tab, the photo in the header, the rest in the form.
              const target =
                m.kind === 'document'
                  ? href('documents', '#upload')
                  : m.field === 'photo'
                    ? href('overview')
                    : href('job', '#edit');
              return (
                <li key={m.kind === 'field' ? m.field : m.typeId}>
                  {canUse ? (
                    <Link
                      href={target}
                      className="inline-flex min-h-9 items-center rounded-pill border border-line px-3 text-caption font-bold text-link hover:border-primary"
                    >
                      {label}
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-9 items-center rounded-pill border border-line px-3 text-caption">
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

async function OverviewTab({ file, canManage }: { file: File; canManage: boolean }) {
  const [docs, lists, t, tp, th, locale] = await Promise.all([
    apiGet<{ checklist: DocumentChecklist }>(`/hr/employees/${file.id}/documents`),
    apiGet<EmployeeChecklist[]>(`/hr/employees/${file.id}/checklists`),
    getTranslations('hr1'),
    getTranslations('people'),
    getTranslations('hr'),
    getLocale(),
  ]);
  const today = cairoDay(new Date());
  const day = (d: string | null) =>
    d ? <span className="ltr-iso">{isoToDayFirst(d)}</span> : null;
  const open = lists.filter((c) => c.status === 'open');
  const todo = docs.checklist.items.filter((i) => i.required && i.state !== 'verified');
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card title={tp('contact')}>
        <dl>
          <Row label={th('fields.mobile')}>
            {file.mobile && (
              <a href={`tel:${file.mobile}`} className="ltr-iso text-link">
                {file.mobile}
              </a>
            )}
          </Row>
          <Row label={tp('email')}>
            <span className="ltr-iso break-all">{file.user.email}</span>
          </Row>
          <Row label={th('fields.emergencyName')}>{file.emergencyName}</Row>
          <Row label={th('fields.emergencyPhone')}>
            {file.emergencyPhone && (
              <a href={`tel:${file.emergencyPhone}`} className="ltr-iso text-link">
                {file.emergencyPhone}
              </a>
            )}
          </Row>
          <Row label={th('fields.address')}>{file.address}</Row>
        </dl>
      </Card>
      <Card title={tp('contractCard')}>
        <dl>
          <Row label={tp('employment')}>
            {file.employment === 'outsourced'
              ? tp('outsourcedVia', { company: file.staffingSupplier?.name ?? '–' })
              : tp('employments.employee')}
          </Row>
          <Row label={th('fields.contractType')}>{th(`contractTypes.${file.contractType}`)}</Row>
          <Row label={th('fields.hireDate')}>{day(file.hireDate)}</Row>
          <Row label={th('fields.contractEndsOn')}>{day(file.contractEndsOn)}</Row>
          <Row label={th('fields.probationEndsOn')}>
            {file.probationEnd && (
              <span className={file.probationEnd >= today ? 'text-status-needs-action' : undefined}>
                {isoToDayFirst(file.probationEnd)}
                {!file.probationEndsOn && (
                  <span className="block text-caption font-normal text-text-muted">
                    {t('file.probationFromHire')}
                  </span>
                )}
              </span>
            )}
          </Row>
          {file.salary && (
            <Row label={tp('gross')}>
              <span className="ltr-iso">{formatEgp(file.salary.grossPiastres)}</span>
            </Row>
          )}
        </dl>
      </Card>
      <Card
        title={tp('tabs.documents')}
        action={
          <Link
            href={`/admin/hr/${file.id}?tab=documents`}
            className="text-body-sm font-bold text-link"
          >
            {tp('open')}
          </Link>
        }
      >
        <p className="text-body-sm">
          {t('file.documentsLine', {
            done: docs.checklist.done,
            required: docs.checklist.required,
          })}
        </p>
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
        title={tp('tabs.checklists')}
        action={
          <Link
            href={`/admin/hr/${file.id}?tab=checklists`}
            className="text-body-sm font-bold text-link"
          >
            {tp('open')}
          </Link>
        }
      >
        {open.length === 0 ? (
          <p className="text-body-sm text-text-muted">{tp('noOpenChecklist')}</p>
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
                    {tp('lateTasks', { count: c.tasks.filter((x) => x.overdue).length })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={tp('identity')}>
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
      <Card title={tp('tabs.team')}>
        <p className="text-body-sm">
          {file.team && file.team.total > 0
            ? tp('teamLine', { direct: file.team.direct, total: file.team.total })
            : tp('teamEmpty')}
        </p>
        {file.managerSource === 'department' && file.effectiveManager && (
          <p className="mt-2 text-caption text-text-muted">{tp('managerFromChain')}</p>
        )}
      </Card>
      {canManage && (
        <div id="status" className="scroll-mt-20 lg:col-span-3">
          <EmployeeStatusPanel
            employeeId={file.id}
            status={file.status}
            today={today}
            leavingHref={file.status === 'left' ? null : `/admin/hr/${file.id}/leaving`}
          />
        </div>
      )}
    </div>
  );
}

async function JobTab({ file, canUse }: { file: File; canUse: boolean }) {
  const [stores, people, departments, positions, grades, suppliers, history, t, tp, th, locale] =
    await Promise.all([
      apiGet<AdminStore[]>('/admin/dark-stores'),
      apiGet<EmployeeRow[]>('/hr/employees?status=active'),
      apiGet<DepartmentRow[]>('/hr/departments'),
      apiGet<PositionRow[]>('/hr/positions'),
      apiGet<GradeRow[]>('/hr/grades'),
      apiGet<{ id: string; name: string }[]>('/hr/staffing-companies'),
      apiGet<HistoryRow[]>(`/hr/employees/${file.id}/history`),
      getTranslations('hr1'),
      getTranslations('people'),
      getTranslations('hr'),
      getLocale(),
    ]);
  const named = (x: { nameEn: string; nameAr: string | null } | undefined) =>
    x ? (locale === 'ar' && x.nameAr ? x.nameAr : x.nameEn) : null;
  const value = (field: string, v: string | null) => {
    if (!v) return '–';
    switch (field) {
      case 'departmentId':
        return named(departments.find((d) => d.id === v)) ?? '–';
      case 'positionId': {
        const p = positions.find((x) => x.id === v);
        return p ? (locale === 'ar' ? p.titleAr : p.titleEn) : '–';
      }
      case 'gradeId':
        return named(grades.find((g) => g.id === v)) ?? '–';
      case 'managerId': {
        const m = people.find((x) => x.id === v);
        return m ? employeeName(m, locale) : '–';
      }
      case 'homeStoreId': {
        const s = stores.find((x) => x.id === v);
        return s ? localized(s, locale) : '–';
      }
      case 'contractType':
        return th(`contractTypes.${v}`);
      case 'employment':
        return tp(`employments.${v}`);
      default:
        return v;
    }
  };
  const moves = jobMoves(history);
  const position =
    (file.position && (locale === 'ar' ? file.position.titleAr : file.position.titleEn)) ??
    file.jobTitle;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="min-w-0 space-y-4">
        <Card title={t('job.now')}>
          <dl>
            <Row label={tp('position')}>{position}</Row>
            <Row label={tp('grade')}>{named(file.grade ?? undefined)}</Row>
            <Row label={tp('department')}>{named(file.department ?? undefined)}</Row>
            <Row label={tp('reportsTo')}>
              {file.effectiveManager && (
                <Link href={`/admin/hr/${file.effectiveManager.id}`} className="text-link">
                  {employeeName(file.effectiveManager, locale)}
                </Link>
              )}
            </Row>
            <Row label={tp('store')}>
              {file.homeStore ? localized(file.homeStore, locale) : th('office')}
            </Row>
          </dl>
        </Card>
        <EmploymentPanel file={file} suppliers={suppliers} canEdit={canUse} />
        <div id="edit" className="scroll-mt-20">
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
      </div>
      <Card title={t('job.moves')}>
        {moves.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('job.noMoves')}</p>
        ) : (
          <ol className="space-y-3">
            {moves.map((m) => (
              <li key={m.id} className="border-s-2 border-line ps-3">
                <p className="text-caption text-text-muted">
                  <span className="ltr-iso">{isoToDayFirst(cairoDay(new Date(m.at)))}</span>
                  {m.by && ` · ${m.by}`}
                  {m.opened && ` · ${t('job.opened')}`}
                </p>
                <ul className="mt-1 space-y-0.5 text-body-sm">
                  {m.changes.map((c) => (
                    <li key={c.field}>
                      <span className="text-text-muted">{t(`job.fields.${c.field}`)}: </span>
                      {m.opened ? (
                        <bdi className="font-bold">{value(c.field, c.to)}</bdi>
                      ) : (
                        <>
                          <bdi>{value(c.field, c.from)}</bdi> →{' '}
                          <bdi className="font-bold">{value(c.field, c.to)}</bdi>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

async function PayTab({
  file,
  canEdit,
  payroll,
}: {
  file: File;
  canEdit: boolean;
  payroll: string | null;
}) {
  const rider = file.user.role === 'rider';
  // Riders paid per delivered order have no salary package (CLAUDE.md "Rider pay").
  if (file.payBasis === 'per_delivery')
    return <PayBasisPanel file={file} canEdit={canEdit && rider} />;
  const pkg = await apiGet<{ history: SalaryPackage[] }>(`/hr/employees/${file.id}/package`);
  return (
    <>
      {rider && <PayBasisPanel file={file} canEdit={canEdit} />}
      <SalaryPackagePanel
        file={file}
        history={pkg.history}
        canEdit={canEdit}
        payrollHref={payroll}
      />
    </>
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
    <div id="upload" className="scroll-mt-20">
      <DocumentsPanel
        checklist={data.checklist}
        documents={data.documents}
        types={canUse ? types : []}
        mode={{ kind: 'hr', employeeId: id, canUse, canManage }}
      />
    </div>
  );
}

/** Today's punches and the last 30 closed days, each opening the day to see or fix it. */
async function AttendanceTab({ file }: { file: File }) {
  const today = cairoDay(new Date());
  const from = addDays(today, -30);
  const [todayDetail, days, t, ta] = await Promise.all([
    apiGet<DayDetail>(`/hr/attendance/day?employeeId=${file.id}&day=${today}`),
    apiGet<DayListRow[]>(`/hr/attendance/days?employeeId=${file.id}&from=${from}&to=${today}`),
    getTranslations('hr1'),
    getTranslations('attendance'),
  ]);
  const dayHref = (d: string) => `/admin/hr/attendance/day?employeeId=${file.id}&day=${d}`;
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';
  const late = days.filter((d) => d.status === 'late').length;
  const absent = days.filter((d) => d.status === 'absent').length;
  return (
    <div className="mt-4 space-y-4">
      <Card
        title={t('attendance.today')}
        action={
          <Link href={dayHref(today)} className="text-body-sm font-bold text-link">
            {t('attendance.openDay')}
          </Link>
        }
      >
        <p className="text-body-sm">
          {todayDetail.plan
            ? t('attendance.shift', {
                start: cairoHm(todayDetail.plan.start),
                end: cairoHm(todayDetail.plan.end),
              })
            : todayDetail.dayOff
              ? t('attendance.dayOff')
              : t('attendance.noShift')}
        </p>
        {todayDetail.punches.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('attendance.noPunches')}</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {todayDetail.punches.map((p) => (
              <li
                key={p.id}
                className={`rounded-pill border border-line px-3 py-1 text-caption ${p.voided ? 'line-through opacity-60' : ''}`}
              >
                {ta(`kinds.${p.kind}`)} <span className="ltr-iso">{cairoHm(p.at)}</span>
                {p.source !== 'app' && ` · ${ta(`sources.${p.source}`)}`}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
          <h2 className="text-h3">{t('attendance.last30')}</h2>
          <p className="text-caption text-text-muted">
            {t('attendance.summary', { days: days.length, late, absent })}
          </p>
        </div>
        {days.length === 0 ? (
          <p className="p-4 text-body-sm text-text-muted">{t('attendance.noDays')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-body-sm">
              <thead>
                <tr>
                  <th className={th}>{ta('columns.day')}</th>
                  <th className={th}>{ta('columns.status')}</th>
                  <th className={th}>{ta('columns.in')}</th>
                  <th className={th}>{ta('columns.out')}</th>
                  <th className={th}>{ta('columns.worked')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {days.map((d) => (
                  <tr key={d.id}>
                    <td className={`${td} ltr-iso`}>
                      <Link href={dayHref(d.day)} className="text-link">
                        {isoToDayFirst(d.day)}
                      </Link>
                    </td>
                    <td className={td}>
                      <AttendancePill state={d.status} label={ta(`statuses.${d.status}`)} />
                      {d.flags.map((f) => (
                        <span key={f} className="mt-1 block text-caption text-text-muted">
                          {ta(`flags.${f}`)}
                        </span>
                      ))}
                    </td>
                    <td className={`${td} ltr-iso`}>{cairoHm(d.firstIn)}</td>
                    <td className={`${td} ltr-iso`}>{cairoHm(d.lastOut)}</td>
                    <td className={`${td} ltr-iso`}>{hours(d.workedMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

async function LeaveTab({ file, canUse }: { file: File; canUse: boolean }) {
  const [data, types, t, t3, locale] = await Promise.all([
    apiGet<EmployeeLeave>(`/hr/employees/${file.id}/leave`),
    apiGet<LeaveType[]>('/hr/leave/types'),
    getTranslations('hr1'),
    getTranslations('hr3'),
    getLocale(),
  ]);
  return (
    <div className="mt-4">
      <BalanceCards balances={data.balances} />
      <h2 className="mt-6 text-h3">{t('leave.requests')}</h2>
      {data.requests.length === 0 ? (
        <EmptyState icon="schedule" title={t('leave.none')} body={t('leave.noneHint')} />
      ) : (
        <LeaveRequestsTable rows={data.requests} hrefBase="/admin/hr/leave" showPerson={false} />
      )}
      {data.adjustments.length > 0 && (
        <section className="mt-4 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('leave.adjustments')}</h2>
          <ul className="mt-2 divide-y divide-line text-body-sm">
            {data.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {a.type ? (locale === 'ar' ? a.type.nameAr : a.type.nameEn) : t3('annualBalance')}{' '}
                  · {a.reason}
                </span>
                <span className="ltr-iso font-bold">
                  {a.days > 0 ? '+' : ''}
                  {a.days}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canUse && (
        <section
          id="ask"
          className="mt-6 scroll-mt-20 rounded-lg border border-line bg-surface p-4"
        >
          <h2 className="text-h3">{t('leave.ask')}</h2>
          <p className="mt-1 text-caption text-text-muted">{t3('askForSomeoneHint')}</p>
          <LeaveRequestForm
            types={types.filter((x) => x.isActive)}
            people={[{ id: file.id, code: file.code, nameEn: file.nameEn, nameAr: file.nameAr }]}
          />
        </section>
      )}
    </div>
  );
}

async function ViolationsTab({ file, canUse }: { file: File; canUse: boolean }) {
  const [rows, types, t] = await Promise.all([
    apiGet<Violation[]>(`/hr/violations?employeeId=${file.id}`),
    apiGet<ViolationType[]>('/hr/violations/types'),
    getTranslations('hr1'),
  ]);
  return (
    <div className="mt-4">
      {rows.length === 0 ? (
        <EmptyState icon="delivered" title={t('violations.none')} body={t('violations.noneHint')} />
      ) : (
        <ViolationsTable rows={rows} hrefBase="/admin/hr/violations" showPerson={false} />
      )}
      {canUse && (
        <section
          id="record"
          className="mt-6 scroll-mt-20 rounded-lg border border-line bg-surface p-4"
        >
          <h2 className="text-h3">{t('violations.record')}</h2>
          <RecordViolationForm
            types={types.filter((x) => x.isActive)}
            people={[{ id: file.id, code: file.code, nameEn: file.nameEn, nameAr: file.nameAr }]}
            today={cairoDay(new Date())}
          />
        </section>
      )}
    </div>
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

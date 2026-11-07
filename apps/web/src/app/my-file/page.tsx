import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { ClockCard } from '@/components/hr/ClockCard';
import { MyAttendanceDays } from '@/components/hr/MyAttendanceDays';
import { ChecklistsPanel } from '@/components/hr/ChecklistsPanel';
import { DocumentsPanel } from '@/components/hr/DocumentsPanel';
import { EmployeeHeader } from '@/components/hr/EmployeeHeader';
import { PhotoEditor } from '@/components/hr/PhotoEditor';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { homeFor } from '@/lib/access';
import { apiGet, apiTry } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import type {
  DocumentChecklist,
  EmployeeChecklist,
  EmployeeDocument,
  EmployeeFile,
} from '@/lib/hr-types';
import { getCurrentUser } from '@/lib/server-session';
import type { ReminderRow } from '@/lib/hr-phase2';

export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="break-words text-body-sm">{children ?? '–'}</dd>
    </div>
  );
}

type MyFile = EmployeeFile & {
  documents: EmployeeDocument[];
  checklist: DocumentChecklist;
  checklists: EmployeeChecklist[];
  team: { direct: number; total: number };
};

/**
 * My HR: every team member and rider sees their own file with their photo (which they may
 * change), their document checklist (they send what is missing or refused; HR verifies it),
 * their onboarding tasks, their team when they manage people, and their history.
 */
export default async function MyFilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/my-file');
  if (user.role === 'merchant') redirect('/merchant');
  const [file, t, tp, locale, t3, badges, reminders, t2] = await Promise.all([
    apiGet<MyFile>('/me/employee'),
    getTranslations('hr'),
    getTranslations('people'),
    getLocale(),
    getTranslations('hr3'),
    apiTry<{ inbox: number }>('/me/hr-badges'),
    // HR phase 2: what HR asked this person to send.
    apiTry<ReminderRow[]>('/me/employee/reminders'),
    getTranslations('hr2'),
  ]);
  const day = (d: string | null) =>
    d ? <span className="ltr-iso">{isoToDayFirst(d)}</span> : null;
  const phone = (p: string | null) => (p ? <span className="ltr-iso">{p}</span> : null);
  const dl = 'mt-3 grid gap-3 sm:grid-cols-2';
  const box = 'mt-4 rounded-lg border border-line bg-surface p-4';
  // Missing, refused or expired documents are to send; one still valid but running out soon
  // counts as in order (the completeness stays 100%) and is only a reminder to renew.
  const todo = file.checklist.items.filter(
    (i) => i.required && ['missing', 'rejected', 'expired'].includes(i.state),
  );
  const expiring = file.checklist.items.filter((i) => i.state === 'expiring');
  const tasks = file.checklists.filter((c) => c.status !== 'cancelled');

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <Link href={homeFor(user.role) ?? '/'} className="text-body-sm text-link">
          {t('backHome')}
        </Link>
        <p className="mb-2 mt-1 text-body-sm text-text-muted">{tp('myIntro')}</p>
        <EmployeeHeader
          file={{ ...file, completeness: file.checklist }}
          photo={
            <PhotoEditor
              employeeId={file.id}
              photoVersion={file.photoVersion}
              name={file.nameEn}
              uploadPath="/me/employee/photo"
              src={file.photoVersion ? `/api/me/employee/photo?v=${file.photoVersion}` : null}
            />
          }
        />

        {reminders && reminders.length > 0 && (
          <section
            className="mt-4 rounded-lg border border-status-needs-action bg-surface p-4"
            aria-labelledby="hr-asks"
          >
            <h2 id="hr-asks" className="text-body font-bold">
              {t2('my.askTitle')}
            </h2>
            <ul className="mt-2 space-y-1.5">
              {reminders.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-body-sm"
                >
                  <span className="min-w-0">
                    <span className="font-bold">
                      {locale === 'ar' ? r.type.nameAr : r.type.nameEn}
                    </span>
                    <span className="block text-caption text-text-muted">
                      {t2('my.askedBy', { name: r.by, date: isoToDayFirst(r.day) })}
                    </span>
                  </span>
                  <a href="#me-docs" className="text-body-sm font-bold text-link">
                    {r.type.selfUpload ? t2('my.sendNow') : t2('my.bringToHr')}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-4">
          <ClockCard />
        </div>

        <nav
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label={t3('myHrSections')}
        >
          {(
            [
              ['/my-file/leave', 'myLeave', 'myLeaveHint'],
              ['/my-file/violations', 'myViolations', 'myViolationsHint'],
              ['/my-file/corrections', 'myCorrections', 'myCorrectionsHint'],
              ['/my-file/inbox', 'myInbox', 'myInboxHint'],
            ] as const
          ).map(([href, key, hint]) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg border border-line bg-surface p-4 hover:border-primary"
            >
              <span className="flex items-center gap-2 font-bold">
                {t3(`sections.${key}`)}
                {key === 'myInbox' && (badges?.inbox ?? 0) > 0 && (
                  <span className="ltr-iso rounded-pill bg-status-needs-action px-2 text-caption text-white">
                    {badges!.inbox}
                  </span>
                )}
              </span>
              <span className="text-caption text-text-muted">{t3(`sections.${hint}`)}</span>
            </Link>
          ))}
        </nav>

        {(todo.length > 0 || expiring.length > 0 || file.team.total > 0) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {todo.length > 0 && (
              <a
                href="#me-docs"
                className="rounded-lg border border-status-needs-action bg-surface p-4"
              >
                <span className="block font-bold">{tp('myTodo', { count: todo.length })}</span>
                <span className="text-caption text-text-muted">{tp('myTodoHint')}</span>
              </a>
            )}
            {expiring.length > 0 && (
              <a href="#me-docs" className="rounded-lg border border-line bg-surface p-4">
                <span className="block font-bold">
                  {tp('myExpiring', { count: expiring.length })}
                </span>
                <span className="text-caption text-text-muted">{tp('myExpiringHint')}</span>
              </a>
            )}
            {file.team.total > 0 && (
              <Link
                href="/my-file/team"
                className="rounded-lg border border-line bg-surface p-4 hover:border-primary"
              >
                <span className="block font-bold">{tp('myTeam')}</span>
                <span className="text-caption text-text-muted">
                  {tp('teamLine', { direct: file.team.direct, total: file.team.total })}
                </span>
              </Link>
            )}
          </div>
        )}

        <section className="mt-6" aria-labelledby="me-docs-title" id="me-docs">
          <h2 id="me-docs-title" className="text-h3">
            {tp('myDocuments')}
          </h2>
          <DocumentsPanel
            checklist={file.checklist}
            documents={file.documents}
            mode={{ kind: 'self' }}
          />
        </section>

        {tasks.length > 0 && (
          <section className="mt-6" aria-labelledby="me-tasks">
            <h2 id="me-tasks" className="text-h3">
              {tp('tabs.checklists')}
            </h2>
            <ChecklistsPanel
              employeeId={file.id}
              checklists={tasks}
              templates={[]}
              canUse={false}
              canManage={false}
            />
          </section>
        )}

        <MyAttendanceDays />

        <section className={box} aria-labelledby="me-identity">
          <h2 id="me-identity" className="text-h3">
            {tp('identity')}
          </h2>
          <dl className={dl}>
            <Row label={t('fields.nameEn')}>{file.nameEn}</Row>
            <Row label={t('fields.nameAr')}>{file.nameAr}</Row>
            <Row label={t('fields.nationalId')}>
              {file.nationalId && <span className="ltr-iso">{file.nationalId}</span>}
            </Row>
            <Row label={t('fields.nationalIdExpiresOn')}>{day(file.nationalIdExpiresOn)}</Row>
            <Row label={t('fields.birthDate')}>{day(file.birthDate)}</Row>
            <Row label={t('fields.socialInsuranceNumber')}>{file.socialInsuranceNumber}</Row>
            <Row label={t('fields.mobile')}>{phone(file.mobile)}</Row>
            <Row label={t('fields.address')}>{file.address}</Row>
            <Row label={t('fields.emergencyName')}>{file.emergencyName}</Row>
            <Row label={t('fields.emergencyPhone')}>{phone(file.emergencyPhone)}</Row>
          </dl>
        </section>

        <section className={box} aria-labelledby="me-job">
          <h2 id="me-job" className="text-h3">
            {tp('contractCard')}
          </h2>
          <dl className={dl}>
            <Row label={tp('employment')}>
              {file.employment === 'outsourced'
                ? tp('outsourcedVia', { company: file.staffingSupplier?.name ?? '–' })
                : tp('employments.employee')}
            </Row>
            <Row label={t('fields.contractType')}>{t(`contractTypes.${file.contractType}`)}</Row>
            <Row label={t('fields.hireDate')}>{day(file.hireDate)}</Row>
            <Row label={t('fields.contractEndsOn')}>{day(file.contractEndsOn)}</Row>
            <Row label={t('fields.probationEndsOn')}>{day(file.probationEndsOn)}</Row>
            <Row label={tp('grade')}>
              {file.grade ? (locale === 'ar' ? file.grade.nameAr : file.grade.nameEn) : null}
            </Row>
          </dl>
        </section>

        {file.bank && (
          <section className={box} aria-labelledby="me-bank">
            <h2 id="me-bank" className="text-h3">
              {t('sections.bank')}
            </h2>
            <dl className={dl}>
              <Row label={t('fields.bankName')}>{file.bank.bankName}</Row>
              <Row label={t('fields.bankAccountNumber')}>{file.bank.bankAccountNumber}</Row>
              <Row label={t('fields.iban')}>
                {file.bank.iban && <span className="ltr-iso break-all">{file.bank.iban}</span>}
              </Row>
              <Row label={t('fields.bankAccountHolder')}>{file.bank.bankAccountHolder}</Row>
            </dl>
          </section>
        )}
        <p className="mt-3 text-caption text-text-muted">{t('myCorrections')}</p>

        <RecordHistory entityType="employee" entityId={file.id} path="/me/employee/history" />
      </main>
    </div>
  );
}

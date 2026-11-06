import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { ClockCard } from '@/components/hr/ClockCard';
import { MyAttendanceDays } from '@/components/hr/MyAttendanceDays';
import { DocumentsPanel } from '@/components/hr/DocumentsPanel';
import { StatusChip } from '@/components/hr/StatusChip';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { localized } from '@/lib/admin-types';
import { homeFor } from '@/lib/access';
import { apiGet } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { type EmployeeDocument, type EmployeeFile, employeeName } from '@/lib/hr-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="break-words text-body-sm">{children ?? '–'}</dd>
    </div>
  );
}

/** My HR: every team member and rider reads their own file, documents and history. */
export default async function MyFilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/my-file');
  if (user.role === 'merchant') redirect('/merchant');
  const [file, t, locale] = await Promise.all([
    apiGet<EmployeeFile & { documents: EmployeeDocument[] }>('/me/employee'),
    getTranslations('hr'),
    getLocale(),
  ]);
  const day = (d: string | null) =>
    d ? <span className="ltr-iso">{isoToDayFirst(d)}</span> : null;
  const phone = (p: string | null) => (p ? <span className="ltr-iso">{p}</span> : null);
  const dl = 'mt-3 grid gap-3 sm:grid-cols-2';
  const box = 'mt-4 rounded-lg border border-line bg-surface p-4';

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link href={homeFor(user.role) ?? '/'} className="text-body-sm text-link">
          {t('backHome')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-h2">{t('myTitle')}</h1>
          <StatusChip status={file.status} label={t(`statuses.${file.status}`)} />
        </div>
        <p className="mt-1 text-body-sm text-text-muted">{t('myIntro')}</p>

        <div className="mt-4">
          <ClockCard />
        </div>
        <MyAttendanceDays />

        <section className={box} aria-labelledby="me-identity">
          <h2 id="me-identity" className="text-h3">
            {employeeName(file, locale)}{' '}
            <span className="ltr-iso text-text-muted">{file.code}</span>
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
            {t('sections.job')}
          </h2>
          <dl className={dl}>
            <Row label={t('fields.jobTitle')}>{file.jobTitle}</Row>
            <Row label={t('fields.department')}>
              {file.department ? t(`departments.${file.department}`) : null}
            </Row>
            <Row label={t('fields.manager')}>
              {file.manager ? employeeName(file.manager, locale) : null}
            </Row>
            <Row label={t('fields.homeStore')}>
              {file.homeStore ? localized(file.homeStore, locale) : t('office')}
            </Row>
            <Row label={t('fields.hireDate')}>{day(file.hireDate)}</Row>
            <Row label={t('fields.contractType')}>{t(`contractTypes.${file.contractType}`)}</Row>
            <Row label={t('fields.contractEndsOn')}>{day(file.contractEndsOn)}</Row>
            <Row label={t('fields.probationEndsOn')}>{day(file.probationEndsOn)}</Row>
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

        <section className="mt-6" aria-labelledby="me-docs">
          <h2 id="me-docs" className="text-h3">
            {t('tabs.documents')}
          </h2>
          <DocumentsPanel
            documents={file.documents}
            downloadBase="/api/me/employee/documents"
            today={cairoDay(new Date())}
          />
        </section>

        <RecordHistory entityType="employee" entityId={file.id} path="/me/employee/history" />
      </main>
    </div>
  );
}

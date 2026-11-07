import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { StatCard } from '@/components/StatCard';
import { Avatar } from '@/components/hr/Avatar';
import { btnPrimary, btnSecondary, HrPageHeader } from '@/components/hr/HrPage';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import type { HrOverview } from '@/lib/hr-overview-types';
import { employeeName } from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

function Card({
  title,
  action,
  children,
  wide = false,
}: {
  title: string;
  action?: { href: string; label: string };
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={`flex flex-col rounded-xl bg-surface p-4 shadow-sm ${wide ? 'lg:col-span-2' : ''}`}
    >
      <h2 className="text-h3">{title}</h2>
      <div className="mt-3 flex-1">{children}</div>
      {action && (
        <Link href={action.href} className={`${btnSecondary} mt-4 self-start`}>
          {action.label}
        </Link>
      )}
    </section>
  );
}

/** A count with its label; a link when there is something to open. */
function Figure({
  label,
  value,
  href,
  warn = false,
}: {
  label: string;
  value: number;
  href?: string;
  warn?: boolean;
}) {
  const body = (
    <>
      <span
        className={`tabular ltr-iso text-h3 ${warn && value > 0 ? 'text-status-needs-action' : ''}`}
      >
        {value}
      </span>
      <span className="text-caption text-text-muted">{label}</span>
    </>
  );
  return href && value > 0 ? (
    <Link
      href={href}
      className="flex flex-col rounded-md border border-line px-3 py-2 hover:border-primary"
    >
      {body}
    </Link>
  ) : (
    <span className="flex flex-col rounded-md border border-line px-3 py-2">{body}</span>
  );
}

/**
 * The HR home (HR phase 1): one screen of what needs attention today, each with a button to
 * act. People limited to some stores see only those stores.
 */
export default async function HrHomePage() {
  const [o, profile, stores, t, th, locale] = await Promise.all([
    apiGet<HrOverview>('/hr/overview'),
    getMyProfile(),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    getTranslations('hr1'),
    getTranslations('hr'),
    getLocale(),
  ]);
  const name = (p: { nameEn: string; nameAr: string | null }) => employeeName(p, locale);
  const day = (d: string) => <span className="ltr-iso">{isoToDayFirst(d)}</span>;
  const limited = profile && !profile.allStores;
  const myStores = limited
    ? stores
        .filter((s) => profile.storeIds.includes(s.id))
        .map((s) => localized(s, locale))
        .join('، ')
    : null;
  const maxDept = Math.max(1, ...o.headcount.byDepartment.map((d) => d.count));
  const nothingNow =
    o.inbox.total === 0 &&
    o.violations.suggested === 0 &&
    o.documents.missing + o.documents.expired + o.documents.waiting === 0;

  return (
    <>
      <HrPageHeader
        title={t('home.title')}
        intro={
          <>
            {t('home.intro')} {day(o.day)}
            {myStores && (
              <span className="mt-1 block">{t('home.scope', { stores: myStores })}</span>
            )}
          </>
        }
        actions={
          <>
            <Link href="/admin/hr" className={btnSecondary}>
              {t('home.openList')}
            </Link>
            <Link href="/admin/hr/attendance" className={btnPrimary}>
              {t('home.openToday')}
            </Link>
          </>
        }
      />
      {o.now.holiday && (
        <p className="mt-3 rounded-md border border-line bg-surface-raised p-3 text-body-sm">
          {t('home.holiday', {
            name: locale === 'ar' ? o.now.holiday.nameAr : o.now.holiday.nameEn,
          })}
        </p>
      )}

      <h2 className="mt-6 text-h3">{t('home.rightNow')}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link
          href="/admin/hr/attendance"
          className="block rounded-xl hover:ring-2 hover:ring-primary"
        >
          <StatCard label={t('home.in')} value={String(o.now.in)} tone="delivered" icon="account" />
        </Link>
        <Link
          href="/admin/hr/attendance"
          className="block rounded-xl hover:ring-2 hover:ring-primary"
        >
          <StatCard
            label={t('home.late')}
            value={String(o.now.late)}
            tone="needs-action"
            icon="schedule"
            alert={o.now.late > 0}
          />
        </Link>
        <Link
          href="/admin/hr/attendance"
          className="block rounded-xl hover:ring-2 hover:ring-primary"
        >
          <StatCard
            label={t('home.absent')}
            value={String(o.now.absent)}
            tone="needs-action"
            icon="alert"
            alert={o.now.absent > 0}
          />
        </Link>
        <Link
          href="/admin/hr/leave/calendar"
          className="block rounded-xl hover:ring-2 hover:ring-primary"
        >
          <StatCard
            label={t('home.onLeave')}
            value={String(o.now.onLeave)}
            tone="new"
            icon="schedule"
          />
        </Link>
      </div>
      <p className="mt-2 text-caption text-text-muted">
        {t('home.restOfDay', { notYet: o.now.notYet, left: o.now.left, off: o.now.off })}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card
          title={t('home.attentionTitle')}
          action={{ href: '/admin/hr/attendance', label: t('home.openToday') }}
        >
          {o.now.attention.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('home.attentionNone')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.now.attention.map((p) => (
                <li key={p.employee.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <Link
                      href={`/admin/hr/attendance/day?employeeId=${p.employee.id}&day=${o.now.day}`}
                      className="block truncate font-bold text-link"
                    >
                      {name(p.employee)}
                    </Link>
                    <span className="block truncate text-caption text-text-muted">
                      {p.store ? localized(p.store, locale) : th('office')}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-caption font-bold ${p.state === 'missing' ? 'text-danger' : 'text-status-needs-action'}`}
                  >
                    {p.state === 'missing'
                      ? t('home.absentFor', { minutes: p.missingMinutes })
                      : t('home.lateBy', { minutes: p.lateMinutes })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {o.now.onLeaveList.length > 0 && (
            <p className="mt-3 text-caption text-text-muted">
              {t('home.onLeaveNames', {
                names: o.now.onLeaveList.map((p) => name(p.employee)).join('، '),
              })}
            </p>
          )}
        </Card>

        <Card
          title={t('home.waitingTitle')}
          action={{ href: '/admin/hr/inbox', label: t('home.openInbox') }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Figure
              label={t('home.leaveRequests')}
              value={o.inbox.leave}
              href="/admin/hr/inbox"
              warn
            />
            <Figure
              label={t('home.corrections')}
              value={o.inbox.corrections}
              href="/admin/hr/inbox"
              warn
            />
            <Figure label={t('home.appeals')} value={o.inbox.appeals} href="/admin/hr/inbox" warn />
            <Figure
              label={t('home.suggested')}
              value={o.violations.suggested}
              href="/admin/hr/violations/suggested"
              warn
            />
          </div>
          <p className="mt-3 text-caption text-text-muted">
            {t('home.openViolations', { count: o.violations.open })}{' '}
            {o.violations.open > 0 && (
              <Link href="/admin/hr?flag=open_violations" className="font-bold text-link">
                {t('home.whoHasThem')}
              </Link>
            )}
          </p>
          {nothingNow && (
            <p className="mt-2 text-body-sm text-status-delivered">{t('home.allClear')}</p>
          )}
        </Card>

        <Card
          title={t('home.documentsTitle')}
          action={{ href: '/admin/hr/documents', label: t('home.openDocuments') }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Figure
              label={t('home.docMissing')}
              value={o.documents.missing}
              href="/admin/hr/documents?state=missing"
              warn
            />
            <Figure
              label={t('home.docWaiting')}
              value={o.documents.waiting}
              href="/admin/hr/documents"
              warn
            />
            <Figure
              label={t('home.docExpiring')}
              value={o.documents.expiring}
              href="/admin/hr/documents?state=expiring"
            />
            <Figure
              label={t('home.docExpired')}
              value={o.documents.expired}
              href="/admin/hr/documents?state=expired"
              warn
            />
          </div>
          {o.documents.soon.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {o.documents.soon.map((d) => (
                <li
                  key={`${d.employee.id}-${d.type.id}`}
                  className="flex items-center justify-between gap-2 text-body-sm"
                >
                  <Link
                    href={`/admin/hr/${d.employee.id}?tab=documents`}
                    className="min-w-0 truncate text-link"
                  >
                    {name(d.employee)} · {locale === 'ar' ? d.type.nameAr : d.type.nameEn}
                  </Link>
                  {d.expiresOn && (
                    <span
                      className={`shrink-0 text-caption ${d.state === 'expired' ? 'text-danger' : 'text-status-needs-action'}`}
                    >
                      {day(d.expiresOn)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t('home.checklistsTitle')}
          action={{ href: '/admin/hr/checklists', label: t('home.openChecklists') }}
        >
          <div className="grid grid-cols-3 gap-2">
            <Figure label={t('home.onboarding')} value={o.checklists.onboarding} />
            <Figure label={t('home.offboarding')} value={o.checklists.offboarding} />
            <Figure label={t('home.withLateTasks')} value={o.checklists.overdue} warn />
          </div>
          {o.checklists.list.length === 0 ? (
            <p className="mt-3 text-body-sm text-text-muted">{t('home.noChecklists')}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {o.checklists.list.map((c) => (
                <li key={c.id}>
                  <div className="flex justify-between gap-2 text-body-sm">
                    <Link
                      href={`/admin/hr/${c.employee.id}?tab=checklists`}
                      className="min-w-0 truncate text-link"
                    >
                      {name(c.employee)}
                    </Link>
                    <span className="ltr-iso shrink-0">
                      {c.done}/{c.total}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-raised">
                    <div
                      className={`h-full ${c.overdue > 0 ? 'bg-status-needs-action' : 'bg-primary'}`}
                      style={{ width: `${c.total ? Math.round((c.done / c.total) * 100) : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('home.endingTitle')}>
          {o.probation.length === 0 && o.contracts.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('home.nothingEnding')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.probation.map((p) => (
                <li
                  key={`p-${p.employee.id}`}
                  className="flex justify-between gap-2 py-2 text-body-sm"
                >
                  <Link
                    href={`/admin/hr/${p.employee.id}?tab=job`}
                    className="min-w-0 truncate text-link"
                  >
                    {name(p.employee)}
                  </Link>
                  <span className="shrink-0 text-caption">
                    {t('home.probationEnds')} {day(p.on)}
                  </span>
                </li>
              ))}
              {o.contracts.map((p) => (
                <li
                  key={`c-${p.employee.id}`}
                  className="flex justify-between gap-2 py-2 text-body-sm"
                >
                  <Link
                    href={`/admin/hr/${p.employee.id}?tab=job`}
                    className="min-w-0 truncate text-link"
                  >
                    {name(p.employee)}
                  </Link>
                  <span className="shrink-0 text-caption text-status-needs-action">
                    {t('home.contractEnds')} {day(p.on)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('home.celebrateTitle')}>
          {o.birthdays.length === 0 && o.anniversaries.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('home.nothingToCelebrate')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.birthdays.map((b) => (
                <li
                  key={`b-${b.employee.id}`}
                  className="flex items-center gap-3 py-2 text-body-sm"
                >
                  <Avatar
                    employeeId={b.employee.id}
                    photoVersion={b.photoVersion}
                    name={b.employee.nameEn}
                  />
                  <span className="min-w-0 flex-1">
                    <Link href={`/admin/hr/${b.employee.id}`} className="block truncate text-link">
                      {name(b.employee)}
                    </Link>
                    <span className="text-caption text-text-muted">{t('home.birthday')}</span>
                  </span>
                  <span className="shrink-0 text-caption">{day(b.on)}</span>
                </li>
              ))}
              {o.anniversaries.map((b) => (
                <li
                  key={`a-${b.employee.id}`}
                  className="flex items-center gap-3 py-2 text-body-sm"
                >
                  <Avatar
                    employeeId={b.employee.id}
                    photoVersion={b.photoVersion}
                    name={b.employee.nameEn}
                  />
                  <span className="min-w-0 flex-1">
                    <Link href={`/admin/hr/${b.employee.id}`} className="block truncate text-link">
                      {name(b.employee)}
                    </Link>
                    <span className="text-caption text-text-muted">
                      {t('home.anniversary', { years: b.years })}
                    </span>
                  </span>
                  <span className="shrink-0 text-caption">{day(b.on)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t('home.headcountTitle')}
          action={{ href: '/admin/hr/org', label: t('home.openOrg') }}
          wide
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label={t('home.total')} value={o.headcount.total} />
            <Figure label={t('home.active')} value={o.headcount.active} />
            <Figure label={t('home.employees')} value={o.headcount.byEmployment.employee} />
            <Figure label={t('home.outsourced')} value={o.headcount.byEmployment.outsourced} />
          </div>
          {o.headcount.byDepartment.length === 0 ? (
            <p className="mt-3 text-body-sm text-text-muted">{t('home.noPeople')}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {o.headcount.byDepartment.map((d) => (
                <li
                  key={d.department?.id ?? 'none'}
                  className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-body-sm"
                >
                  {d.department ? (
                    <Link
                      href={`/admin/hr?department=${d.department.id}`}
                      className="truncate text-link"
                    >
                      {locale === 'ar' ? d.department.nameAr : d.department.nameEn}
                    </Link>
                  ) : (
                    <span className="truncate text-text-muted">{t('home.noDepartment')}</span>
                  )}
                  <span className="h-2 overflow-hidden rounded-pill bg-surface-raised">
                    <span
                      className="block h-full rounded-pill bg-primary"
                      style={{ width: `${Math.round((d.count / maxDept) * 100)}%` }}
                    />
                  </span>
                  <span className="tabular ltr-iso text-end">{d.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

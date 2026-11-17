import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StateChip } from '@/components/hr/DocumentsPanel';
import { btnSecondary, EmptyState, HrPageHeader } from '@/components/hr/HrPage';
import { apiGet } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { type ExpiringDocs, monthGrid, shiftMonth } from '@/lib/hr-phase2';

export const dynamic = 'force-dynamic';

/** Saturday first, as the roster's weeks run. */
const WEEK = [6, 0, 1, 2, 3, 4, 5] as const;

/**
 * HR phase 2: the expiry calendar. A month grid of documents running out (each day shows how
 * many, red once past), then the list day by day with each person's file a tap away.
 */
export default async function ExpiryCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const asked = (await searchParams).month;
  const month =
    asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : cairoDay(new Date()).slice(0, 7);
  const [data, t, locale] = await Promise.all([
    apiGet<ExpiringDocs>(`/hr/documents/expiring?month=${month}`),
    getTranslations('hr2'),
    getLocale(),
  ]);
  // 1 November 2026 was a Sunday, so the (1 + d)th falls on weekday d.
  const weekday = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const dayName = (d: number) => weekday.format(new Date(Date.UTC(2026, 10, 1 + d)));
  const byDay = new Map<string, ExpiringDocs['items']>();
  for (const i of data.items) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);
  const title = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
  const name = (x: { nameEn: string; nameAr: string | null }) =>
    locale === 'ar' && x.nameAr ? x.nameAr : x.nameEn;

  return (
    <>
      <HrPageHeader
        title={t('calendar.title')}
        intro={t('calendar.intro')}
        back={{ href: '/admin/hr/documents', label: t('calendar.back') }}
      />
      <nav
        className="mt-4 flex items-center justify-between gap-2"
        aria-label={t('calendar.months')}
      >
        <Link href={`?month=${shiftMonth(month, -1)}`} className={btnSecondary}>
          {t('calendar.previous')}
        </Link>
        <h2 className="text-h3">{title}</h2>
        <Link href={`?month=${shiftMonth(month, 1)}`} className={btnSecondary}>
          {t('calendar.next')}
        </Link>
      </nav>

      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line bg-surface-raised text-center text-caption font-bold text-text-muted">
          {WEEK.map((d) => (
            <span key={d} className="truncate px-1 py-2">
              {dayName(d)}
            </span>
          ))}
        </div>
        {monthGrid(month).map((week, i) => (
          <div key={i} className="grid grid-cols-7 border-b border-line last:border-b-0">
            {week.map((day, k) => {
              const items = day ? (byDay.get(day) ?? []) : [];
              const past = day !== null && day < data.today;
              return (
                <div
                  key={k}
                  className={`min-h-16 min-w-0 border-e border-line p-1 last:border-e-0 sm:min-h-24 sm:p-2 ${
                    day === data.today ? 'bg-selected-bg' : ''
                  }`}
                >
                  {day && (
                    <>
                      <span className="ltr-iso block text-caption text-text-muted">
                        {Number(day.slice(8))}
                      </span>
                      {items.length > 0 && (
                        <a
                          href={`#d-${day}`}
                          className={`mt-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-pill px-1.5 text-caption font-bold ${
                            past
                              ? 'bg-danger text-on-status'
                              : 'bg-status-needs-action text-on-status'
                          }`}
                          aria-label={t('calendar.count', { count: items.length })}
                        >
                          <span className="ltr-iso">{items.length}</span>
                        </a>
                      )}
                      <ul className="mt-1 hidden space-y-0.5 lg:block">
                        {items.slice(0, 2).map((x) => (
                          <li key={x.id} className="truncate text-caption">
                            {name(x.employee)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {data.items.length === 0 ? (
        <EmptyState title={t('calendar.empty')} body={t('calendar.emptyBody')} icon="schedule" />
      ) : (
        <ol className="mt-4 space-y-3">
          {[...byDay.entries()].map(([day, items]) => (
            <li
              key={day}
              id={`d-${day}`}
              className="scroll-mt-20 rounded-lg border border-line bg-surface"
            >
              <h3 className="border-b border-line px-3 py-2 text-body font-bold">
                <span className="ltr-iso">{isoToDayFirst(day)}</span>
              </h3>
              <ul className="divide-y divide-line">
                {items.map((x) => (
                  <li
                    key={x.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <Link
                        href={`/admin/hr/${x.employee.id}?tab=documents`}
                        className="font-bold text-link"
                      >
                        {name(x.employee)}
                      </Link>
                      <span className="block text-caption text-text-muted">
                        {locale === 'ar' ? x.type.nameAr : x.type.nameEn} · {x.employee.code}
                      </span>
                    </span>
                    <StateChip state={x.state} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

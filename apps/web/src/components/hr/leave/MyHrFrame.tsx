import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { apiTry } from '@/lib/api-server';
import { getCurrentUser } from '@/lib/server-session';

const SECTIONS = [
  { href: '/my-file', key: 'myFile' },
  { href: '/my-file/leave', key: 'myLeave' },
  { href: '/my-file/violations', key: 'myViolations' },
  { href: '/my-file/corrections', key: 'myCorrections' },
  { href: '/my-file/payslips', key: 'myPayslips' },
  { href: '/my-file/claims', key: 'myClaims' },
  { href: '/my-file/inbox', key: 'myInbox' },
] as const;

/**
 * The frame of the My HR pages (HR phase 3): the header, the way back and the sections of the
 * person's own HR (their file, leave, violations, attendance fixes and, for managers and HR,
 * the inbox with its count), then payslips and expense claims. Printing (a payslip) leaves the
 * header and the sections out.
 */
export async function MyHrFrame({
  current,
  title,
  intro,
  children,
}: {
  current: (typeof SECTIONS)[number]['href'];
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${current}`);
  if (user.role === 'merchant') redirect('/merchant');
  const [t, badges] = await Promise.all([
    getTranslations('hr3'),
    apiTry<{ inbox: number }>('/me/hr-badges'),
  ]);
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="print:hidden">
        <AppHeader />
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 print:p-0">
        <nav className="flex flex-wrap gap-2 print:hidden" aria-label={t('myHrSections')}>
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={current === s.href ? 'page' : undefined}
              className={`flex h-10 items-center gap-2 rounded-md px-3 text-body-sm font-bold ${
                current === s.href
                  ? 'bg-selected-bg text-link'
                  : 'border border-line bg-surface text-text'
              }`}
            >
              {t(`sections.${s.key}`)}
              {s.key === 'myInbox' && (badges?.inbox ?? 0) > 0 && (
                <span className="ltr-iso rounded-pill bg-status-needs-action px-2 text-caption text-white">
                  {badges!.inbox}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <h1 className="mt-4 text-h2 print:hidden">{title}</h1>
        {intro && (
          <p className="mt-1 max-w-3xl text-body-sm text-text-muted print:hidden">{intro}</p>
        )}
        {children}
      </main>
    </div>
  );
}

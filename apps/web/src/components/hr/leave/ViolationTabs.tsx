'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

/** The tabs over the violations pages: the list by status, the suggested ones, for companies. */
export function ViolationTabs({
  current,
  suggested,
}: {
  current: 'all' | 'appealed' | 'final' | 'supplier' | 'suggested';
  suggested: number;
}) {
  const t = useTranslations('hr3');
  const tabs = [
    { id: 'all', href: '/admin/hr/violations' },
    { id: 'appealed', href: '/admin/hr/violations?status=appealed' },
    { id: 'final', href: '/admin/hr/violations?status=final' },
    { id: 'supplier', href: '/admin/hr/violations?status=supplier' },
    { id: 'suggested', href: '/admin/hr/violations/suggested' },
  ] as const;
  return (
    <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('violationsTitle')}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={current === tab.id ? 'page' : undefined}
          className={`flex h-10 items-center gap-2 rounded-md px-3 text-body-sm font-bold ${
            current === tab.id
              ? 'bg-selected-bg text-link'
              : 'border border-line bg-surface text-text'
          }`}
        >
          {t(`violationTabs.${tab.id}`)}
          {tab.id === 'suggested' && suggested > 0 && (
            <span className="ltr-iso rounded-pill bg-status-needs-action px-2 text-caption text-white">
              {suggested}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

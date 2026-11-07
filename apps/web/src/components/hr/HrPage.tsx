import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';

// HR phase 1: one page header and one empty state for every HR page, so each page says in
// plain words what it is for and offers the first thing to do.

export const btnPrimary =
  'inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary active:bg-primary-pressed';
export const btnSecondary =
  'inline-flex h-10 items-center justify-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-text hover:bg-surface-raised';

/** Title, a one or two line explanation, and the page's main actions. */
export function HrPageHeader({
  title,
  intro,
  actions,
  back,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="text-body-sm text-link">
            {back.label}
          </Link>
        )}
        <h1 className="text-h2">{title}</h1>
        {intro && <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** What to show when a list is empty: why, and the first action button when there is one. */
export function EmptyState({
  title,
  body,
  action,
  icon = 'new',
}: {
  title: string;
  body?: ReactNode;
  action?: { href: string; label: string } | ReactNode;
  icon?: IconName;
}) {
  const link =
    action && typeof action === 'object' && 'href' in (action as object)
      ? (action as { href: string; label: string })
      : null;
  return (
    <div className="mt-4 flex flex-col items-center rounded-lg border border-dashed border-line bg-surface px-4 py-8 text-center">
      <Icon name={icon} size={28} className="text-text-muted" />
      <p className="mt-2 text-body font-bold">{title}</p>
      {body && <p className="mt-1 max-w-md text-body-sm text-text-muted">{body}</p>}
      {link ? (
        <Link href={link.href} className={`${btnPrimary} mt-4`}>
          {link.label}
        </Link>
      ) : action ? (
        <div className="mt-4">{action as ReactNode}</div>
      ) : null}
    </div>
  );
}

/** Tabs kept in the address (?tab=): links, so every tab can be shared and reopened. */
export function TabLinks<T extends string>({
  tabs,
  current,
  href,
  label,
  ariaLabel,
  counts = {},
}: {
  tabs: readonly T[];
  current: T;
  href: (tab: T) => string;
  label: (tab: T) => string;
  ariaLabel: string;
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-line" aria-label={ariaLabel}>
      {tabs.map((k) => (
        <Link
          key={k}
          href={href(k)}
          aria-current={current === k ? 'page' : undefined}
          className={`flex h-10 shrink-0 items-center border-b-2 px-3 text-body-sm font-bold ${
            current === k
              ? 'border-primary text-link'
              : 'border-transparent text-text-muted hover:text-text'
          }`}
        >
          {label(k)}
          {!!counts[k] && (
            <span className="ltr-iso ms-1.5 rounded-pill bg-surface-raised px-1.5 text-caption">
              {counts[k]}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

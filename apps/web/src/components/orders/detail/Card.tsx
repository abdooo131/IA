import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';

/** A card of the order page: a title bar with its icon, then the body (same look as Section). */
export function Card({
  title,
  icon,
  action,
  children,
  id,
}: {
  title: string;
  icon: IconName;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="overflow-hidden rounded-xl border border-line bg-surface"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-raised px-4 py-3">
        <h2 className="flex items-center gap-2 text-body font-bold">
          <Icon name={icon} size={18} className="text-link" />
          {title}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A label and its value on one row; the value wraps under the label on narrow cards. */
export function Row({
  label,
  children,
  strong = false,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line py-2 last:border-0">
      <dt className="text-body-sm text-text-muted">{label}</dt>
      <dd className={`min-w-0 text-end text-body-sm ${strong ? 'font-bold' : ''}`}>{children}</dd>
    </div>
  );
}

/** A small pill in a status color on a 14% tint of itself. */
export function Pill({
  tone,
  children,
}: {
  tone: 'delivered' | 'needs-action' | 'new' | 'in-progress' | 'danger';
  children: ReactNode;
}) {
  const ink = {
    delivered: 'text-status-delivered',
    'needs-action': 'text-status-needs-action',
    new: 'text-status-new',
    'in-progress': 'text-status-in-progress',
    danger: 'text-danger',
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-pill bg-[color-mix(in_srgb,currentColor_14%,transparent)] px-2 py-0.5 text-caption font-bold ${ink}`}
    >
      {children}
    </span>
  );
}

import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';

/** A soft card of the order page with an icon title, after the brand guide's product screen. */
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
    <section id={id} className="rounded-xl bg-surface p-4 shadow-sm sm:p-5" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-h3">
          <Icon name={icon} size={20} className="text-link" />
          {title}
        </h2>
        {action}
      </div>
      {children}
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

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';

/*
 * The order page layout shared by 60 minute orders and next day parcels (owner, 2026-11-08):
 * a wide column of section cards (title bar, then rows of label over value fields, two per row)
 * and a narrow column of notes, money boxes, fee lines and the payout cycle. Every piece takes
 * ready words, so each service feeds it from its own data and its own translations.
 */

/** Two tabs as a segmented control; the active one lives in the address. */
export function OrderTabs({ tabs }: { tabs: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav role="tablist" className="inline-flex gap-1 rounded-lg bg-surface-raised p-1 print:hidden">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          scroll={false}
          role="tab"
          aria-selected={t.active}
          className={`rounded-md px-3 py-1.5 text-body-sm font-bold ${
            t.active ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export type BannerTone = 'success' | 'info' | 'warning' | 'danger';

const BANNER: Record<BannerTone, { box: string; icon: IconName; ink: string }> = {
  success: {
    box: 'border-status-delivered bg-[color-mix(in_srgb,var(--shiply-status-delivered)_10%,transparent)]',
    icon: 'delivered',
    ink: 'text-status-delivered',
  },
  info: { box: 'border-primary bg-selected-bg', icon: 'tracking', ink: 'text-link' },
  warning: {
    box: 'border-status-needs-action bg-[color-mix(in_srgb,var(--shiply-status-needs-action)_10%,transparent)]',
    icon: 'schedule',
    ink: 'text-status-needs-action',
  },
  danger: {
    box: 'border-danger bg-[color-mix(in_srgb,var(--shiply-danger)_8%,transparent)]',
    icon: 'alert',
    ink: 'text-danger',
  },
};

/** One banner in the state's colour: where the order is, and what comes next. */
export function StateBanner({
  tone,
  text,
  next,
}: {
  tone: BannerTone;
  text: ReactNode;
  next?: ReactNode;
}) {
  const b = BANNER[tone];
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border px-4 py-3 ${b.box}`}>
      <Icon name={b.icon} size={18} className={`mt-0.5 shrink-0 ${b.ink}`} />
      <div className="text-body-sm text-text">
        <p>{text}</p>
        {next && <p className="mt-1 font-semibold">{next}</p>}
      </div>
    </div>
  );
}

/** A section card: a title bar, then its rows separated by lines. */
export function Section({
  title,
  action,
  children,
  id,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-raised px-4 py-3">
        <h2 className="text-body font-bold">{title}</h2>
        {action}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

/** One row of a section: up to two fields side by side (one under the other on phones). */
export function Fields({ children }: { children: ReactNode }) {
  return <dl className="grid gap-4 px-4 py-3 sm:grid-cols-2">{children}</dl>;
}

/** A small label over its value; `end` sits on the far side of the label (a time, a link). */
export function Field({
  label,
  children,
  end,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  end?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="flex items-baseline justify-between gap-2 text-caption text-text-muted">
        <span>{label}</span>
        {end && <span className="ltr-iso whitespace-nowrap">{end}</span>}
      </dt>
      <dd className="mt-1 break-words text-body-sm text-text">{children}</dd>
    </div>
  );
}

/** A soft pill in a status colour on a 14% tint of itself. */
export function Tag({
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

/** "★★★★☆" in the brand's warning colour, or five empty stars. */
export function Stars({ stars, label }: { stars: number; label: string }) {
  return (
    <span className="ltr-iso text-body tracking-wide" aria-label={label}>
      <span className="text-status-needs-action">{'★'.repeat(stars)}</span>
      <span className="text-line-strong">{'★'.repeat(Math.max(0, 5 - stars))}</span>
    </span>
  );
}

/** The narrow column's card around boxes and fee lines. */
export function SideCard({
  title,
  end,
  children,
}: {
  title?: string;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-3">
      {title && (
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-body-sm font-bold">{title}</h2>
          {end && <span className="ltr-iso text-caption text-text-muted">{end}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A boxed label and value in the narrow column (collection amount, opening allowed...). */
export function SideBox({
  label,
  value,
  action,
}: {
  label: string;
  value: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-2 rounded-lg border border-line px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-body-sm font-semibold">{label}</p>
        <p className="mt-0.5 text-caption text-text-muted">{value}</p>
      </div>
      {action}
    </div>
  );
}

/** Fee lines and their total, amounts on the end side. */
export function FeeLines({
  lines,
  total,
  empty,
}: {
  lines: { label: string; value: string }[];
  total?: { label: string; value: string };
  empty?: string;
}) {
  return (
    <div className="px-1">
      {lines.length === 0 && empty ? (
        <p className="text-caption text-text-muted">{empty}</p>
      ) : (
        <dl className="space-y-1.5">
          {lines.map((l, i) => (
            <div key={`${l.label}-${i}`} className="flex justify-between gap-3 text-body-sm">
              <dt className="text-text-muted">{l.label}</dt>
              <dd className="tabular ltr-iso">{l.value}</dd>
            </div>
          ))}
          {total && (
            <div className="flex justify-between gap-3 border-t border-line pt-2 text-body-sm font-bold">
              <dt>{total.label}</dt>
              <dd className="tabular ltr-iso">{total.value}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

/** The payout cycle: the day, what the payout looks like, paid or not, and how often. */
export function CashCycle({
  title,
  day,
  rows,
  status,
}: {
  title: string;
  day?: string;
  rows: { label: string; value: ReactNode }[];
  status: { label: string; value: string; paid: boolean };
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-body-sm font-bold">{title}</h2>
        {day && <span className="text-caption text-text-muted">{day}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-raised px-4 py-2.5">
        <span className="text-body-sm font-semibold">{status.label}</span>
        <Tag tone={status.paid ? 'delivered' : 'needs-action'}>{status.value}</Tag>
      </div>
      <dl className="space-y-3 px-4 py-3">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-caption text-text-muted">{r.label}</dt>
            <dd className="mt-0.5 text-body-sm">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The page body: the wide column and the narrow one (below it on phones). */
export function OrderColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">{main}</div>
      <div className="min-w-0 space-y-4">{side}</div>
    </div>
  );
}

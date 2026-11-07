'use client';
import Link from 'next/link';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { STATUS_LABELS_AR } from '@shiplynow/shared/parcels';
import { statusLabel } from '@/parcels/lib/format';
import { useLocale, useT } from '@/parcels/lib/i18n';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type Tone = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'accent';
const BUTTON_TONES: Record<Tone, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  success: 'btn btn-primary',
  accent: 'btn-accent',
  ghost: 'btn-ghost',
};

export function Button({ tone = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button type="button" {...props} className={cx(BUTTON_TONES[tone], className)} />;
}

export function LinkButton({ href, children, tone = 'secondary' }: { href: string; children: ReactNode; tone?: Tone }) {
  return <Link href={href} className={BUTTON_TONES[tone]}>{children}</Link>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('field', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('field', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx('field', props.className)} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-caption font-semibold text-text">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-caption text-text-muted">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl bg-surface p-4 shadow-sm sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-h3">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-label uppercase text-text-muted">{eyebrow}</p>}
        <h1 className="text-h2">{title}</h1>
        {subtitle && <p className="mt-2 max-w-3xl text-body-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Status colors follow the brand: new, in progress, heading to customer, delivered, needs action, returning. */
const STATUS_GROUP: Record<string, string> = {
  CREATED: 'bg-status-new',
  PICKED_UP: 'bg-status-in-progress',
  AT_INBOUND: 'bg-status-in-progress',
  SORTED: 'bg-status-in-progress',
  AT_OUTBOUND: 'bg-status-in-progress',
  IN_TRANSIT: 'bg-status-in-progress',
  AT_HUB: 'bg-status-in-progress',
  OUT_FOR_DELIVERY: 'bg-status-heading-to-customer',
  DELIVERED: 'bg-status-delivered',
  ON_HOLD: 'bg-status-needs-action',
  ATTEMPT_FAILED: 'bg-status-needs-action',
  LOST: 'bg-danger',
  RETURNED: 'bg-status-returning',
  CANCELLED: 'bg-text-muted',
};

export function StatusBadge({ status, direction }: { status: string; direction?: string }) {
  const locale = useLocale();
  const t = useT();
  const returning = direction === 'RETURN' && !['RETURNED', 'CANCELLED', 'DELIVERED'].includes(status);
  const label =
    locale === 'ar'
      ? `${returning ? t('Returning') + ' · ' : ''}${STATUS_LABELS_AR[status as keyof typeof STATUS_LABELS_AR] ?? status}`
      : statusLabel(status, direction);
  return (
    <span className={cx('inline-flex whitespace-nowrap rounded-pill px-2.5 py-0.5 text-caption font-bold text-white', returning ? 'bg-status-returning' : STATUS_GROUP[status] ?? 'bg-text-muted')}>
      {label}
    </span>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'lime' }) {
  const tones = {
    slate: 'bg-surface-raised text-text ring-1 ring-line',
    green: 'bg-status-delivered text-white',
    amber: 'bg-status-needs-action text-white',
    red: 'bg-status-returning text-white',
    blue: 'bg-selected-bg text-link',
    lime: 'bg-accent text-on-accent',
  };
  return <span className={cx('inline-flex whitespace-nowrap rounded-pill px-2.5 py-0.5 text-caption font-bold', tones[tone])}>{children}</span>;
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const tones = {
    error: 'border-danger text-text bg-surface',
    success: 'border-status-delivered text-text bg-surface',
    info: 'border-primary text-text bg-selected-bg',
    warning: 'border-status-needs-action text-text bg-surface',
  };
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-md border-s-4 px-3 py-2 text-body-sm shadow-sm', tones[tone])}>{children}</div>;
}

/** Kept for older pages; new pages use StatCard. */
export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <div className="rounded-xl bg-surface p-4 shadow-sm">
      <span aria-hidden="true" className="block h-1.5 w-6 rounded-pill bg-primary" />
      <div className="tabular ltr-iso mt-3 text-number-lg">{value}</div>
      <div className="mt-0.5 text-caption text-text-muted">{label}</div>
      {hint && <div className="mt-1 text-caption text-text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line-strong px-4 py-8 text-center text-body-sm text-text-muted">{children}</div>;
}

export function Loading() {
  const t = useT();
  return <div className="py-10 text-center text-body-sm text-text-muted">{t('Loading…')}</div>;
}

/** A table that scrolls sideways inside its card on small screens, never the page. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="min-w-full text-body-sm">
        <thead>
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 text-start text-label uppercase text-text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('whitespace-nowrap px-3 py-2.5 align-top', className)}>{children}</td>;
}

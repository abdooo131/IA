import { Icon, type IconName } from './Icon';

export type StatTone =
  | 'primary'
  | 'new'
  | 'in-progress'
  | 'heading-to-customer'
  | 'delivered'
  | 'needs-action'
  | 'returning';

const STRIP: Record<StatTone, string> = {
  primary: 'bg-primary',
  new: 'bg-status-new',
  'in-progress': 'bg-status-in-progress',
  'heading-to-customer': 'bg-status-heading-to-customer',
  delivered: 'bg-status-delivered',
  'needs-action': 'bg-status-needs-action',
  returning: 'bg-status-returning',
};

/**
 * A dashboard stat card from the handoff: white card, 1 px line, 4 px strip in the status
 * color, muted label and a large tabular number. Needs action numbers take the status color
 * when there is something to act on.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'primary',
  icon,
  alert = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: StatTone;
  icon?: IconName;
  alert?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface p-4 pt-5">
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${STRIP[tone]}`} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-caption text-text-muted">{label}</p>
        {icon && <Icon name={icon} size={20} className="text-text-muted" />}
      </div>
      <p
        className={`tabular ltr-iso mt-1 block text-number-lg ${
          alert ? 'text-status-needs-action' : ''
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-caption text-text-muted">{hint}</p>}
    </div>
  );
}

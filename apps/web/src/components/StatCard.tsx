import { Icon, type IconName } from './Icon';

export type StatTone =
  | 'primary'
  | 'new'
  | 'in-progress'
  | 'heading-to-customer'
  | 'delivered'
  | 'needs-action'
  | 'returning';

const INK: Record<StatTone, string> = {
  primary: 'text-link',
  new: 'text-status-new',
  'in-progress': 'text-status-in-progress',
  'heading-to-customer': 'text-status-heading-to-customer',
  delivered: 'text-status-delivered',
  'needs-action': 'text-status-needs-action',
  returning: 'text-status-returning',
};

const MARK: Record<StatTone, string> = {
  primary: 'bg-primary',
  new: 'bg-status-new',
  'in-progress': 'bg-status-in-progress',
  'heading-to-customer': 'bg-status-heading-to-customer',
  delivered: 'bg-status-delivered',
  'needs-action': 'bg-status-needs-action',
  returning: 'bg-status-returning',
};

/**
 * A dashboard stat card after the brand guide's product screen ("27 In progress", "9 On the
 * way"): a soft rounded card, the icon on top in the status color (a short color mark when
 * there is no icon), the large tabular number, then the label. Needs action numbers take the
 * status color when there is something to act on.
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
    <div className="flex flex-col rounded-xl bg-surface p-4 shadow-sm">
      {icon ? (
        <Icon name={icon} size={22} className={INK[tone]} />
      ) : (
        <span aria-hidden="true" className={`block h-1.5 w-6 rounded-pill ${MARK[tone]}`} />
      )}
      <p
        className={`tabular ltr-iso mt-3 block text-number-lg ${
          alert ? 'text-status-needs-action' : ''
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-caption text-text-muted">{label}</p>
      {hint && <p className="mt-1 text-caption text-text-muted">{hint}</p>}
    </div>
  );
}

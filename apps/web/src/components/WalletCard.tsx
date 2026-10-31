import { Icon, type IconName } from './Icon';

/**
 * A cash balance card in the handoff's wallet teal: tint background, teal icon, the number
 * in the ink color so it stays readable. Wallet colors appear only on cards like this one.
 */
export function WalletCard({
  label,
  value,
  hint,
  icon = 'cash',
  large = false,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: IconName;
  large?: boolean;
}) {
  return (
    <div className="rounded-lg bg-cash-tint p-4">
      <div className="flex items-center gap-2 text-cash-ink">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-cash">
          <Icon name={icon} size={20} />
        </span>
        <p className="text-caption font-semibold">{label}</p>
      </div>
      <p
        className={`tabular ltr-iso mt-2 block text-cash-ink ${large ? 'text-[36px] font-extrabold leading-tight' : 'text-number-lg'}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-caption text-cash-ink">{hint}</p>}
    </div>
  );
}

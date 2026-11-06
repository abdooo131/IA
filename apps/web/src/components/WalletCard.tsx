import { Icon, type IconName } from './Icon';

/**
 * A money balance card, after the brand guide's COD balance card: a solid Navy ground (Shiply
 * Blue in the dark theme), a small spaced label, the amount large in Cream and the note in
 * Lime. Wallet colors appear only on cards like this one.
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
    <div className="relative overflow-hidden rounded-lg bg-hero p-4 text-hero-ink">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label uppercase">{label}</p>
        <Icon name={icon} size={20} className="text-hero-accent" />
      </div>
      <p
        className={`tabular ltr-iso mt-2 block ${large ? 'text-[40px] font-extrabold leading-tight tracking-[-0.02em]' : 'text-number-lg'}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-caption font-semibold text-hero-accent">{hint}</p>}
    </div>
  );
}

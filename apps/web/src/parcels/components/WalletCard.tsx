import { Icon, type IconName } from './Icon';

/**
 * A money balance card, as in Shiply Now (the brand guide's COD balance card): a Navy ground,
 * a small spaced label, the amount large in Cream, the note in Lime and the S mark faint in the
 * corner. Wallet colors appear only on cards like this one.
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
    <div className="relative isolate overflow-hidden rounded-xl bg-hero p-5 text-hero-ink">
      <img
        src="/brand/mark-reverse.svg"
        alt=""
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-4 -end-3 -z-10 w-auto opacity-25 ${large ? 'h-28' : 'h-20'}`}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-label uppercase opacity-80">{label}</p>
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

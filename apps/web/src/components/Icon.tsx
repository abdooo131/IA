/** The 34 icons from the Shiply handoff, drawn from one sprite in the current text color. */
export type IconName =
  | 'home'
  | 'orders'
  | 'create'
  | 'pickups'
  | 'courier'
  | 'tracking'
  | 'route'
  | 'delivered'
  | 'returns'
  | 'scan'
  | 'print'
  | 'schedule'
  | 'wallet'
  | 'cash'
  | 'payout'
  | 'points'
  | 'invoice'
  | 'packaging'
  | 'inventory'
  | 'products'
  | 'store'
  | 'chat'
  | 'customers'
  | 'analytics'
  | 'international'
  | 'insurance'
  | 'notifications'
  | 'support'
  | 'search'
  | 'filter'
  | 'settings'
  | 'account'
  | 'new'
  | 'alert';

/** Arrow icons point the other way in Arabic; every other icon stays as drawn. */
const MIRRORED: ReadonlySet<IconName> = new Set(['returns', 'payout', 'route']);

export function Icon({
  name,
  size = 24,
  selected = false,
  className = '',
}: {
  name: IconName;
  size?: number;
  selected?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      className={`shrink-0 ${selected ? 'is-selected' : ''} ${
        MIRRORED.has(name) ? 'rtl:-scale-x-100' : ''
      } ${className}`}
    >
      <use href={`/icons/sprite.svg#shiply-${name}`} />
    </svg>
  );
}

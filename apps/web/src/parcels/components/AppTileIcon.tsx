import type { AppDef } from '@/parcels/lib/apps';
import { Icon } from './Icon';

/** White on dark tiles, Navy on light ones, so the icon always stands out (as in Shiply Now). */
export function tileInk(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.3 ? '#082341' : '#FFFFFF';
}

/** An app's square: its icon on the app's own brand color (home tiles and the top bar). */
export function AppTileIcon({ app, size }: { app: Pick<AppDef, 'icon' | 'color'>; size: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'h-16 w-16 rounded-xl' : 'h-7 w-7 rounded-md';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] ${box}`}
      style={{ backgroundColor: app.color, color: tileInk(app.color) }}
    >
      <Icon name={app.icon} size={size === 'lg' ? 32 : 18} />
    </span>
  );
}

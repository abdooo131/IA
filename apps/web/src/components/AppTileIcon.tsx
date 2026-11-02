import type { AppDef } from '@/lib/apps';
import { Icon } from './Icon';

/** An app's square: its icon in white on the app's own color (home tiles and the top bar). */
export function AppTileIcon({
  app,
  size,
}: {
  app: Pick<AppDef, 'icon' | 'color'>;
  size: 'sm' | 'lg';
}) {
  const box = size === 'lg' ? 'h-16 w-16 rounded-xl' : 'h-7 w-7 rounded-md';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center text-white ${box}`}
      style={{ backgroundColor: app.color }}
    >
      <Icon name={app.icon} size={size === 'lg' ? 32 : 18} />
    </span>
  );
}

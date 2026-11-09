import type { MenuItem } from '@/shell/AppShell';

/** Location menu (UI.md Step 3a). */
export const LOCATION_MENU: MenuItem[] = [
  { label: 'location.queue', href: '/location/queue' },
  { label: 'location.finder', href: '/location/finder' },
  { label: 'location.map', href: '/location/map' },
  { label: 'location.places', href: '/location/places' },
  { label: 'location.taught', href: '/location/taught' },
];

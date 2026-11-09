import type { MenuItem } from '@/shell/AppShell';

/** Settings menu for this step (UI.md Step 3l); the other pages come with the modules that need them. */
export const SETTINGS_MENU: MenuItem[] = [
  { label: 'settings.users', href: '/settings/users' },
  { label: 'settings.audit', href: '/settings/audit' },
  { label: 'settings.dead', href: '/settings/dead-letters' },
];

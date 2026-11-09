import type { MenuItem } from '@/shell/AppShell';

/** Agents & Fleet menu (UI.md Step 3g; settlements sit under Agents). */
export const FLEET_MENU: MenuItem[] = [
  { label: 'fleet.agents', items: [{ label: 'fleet.agentsList', href: '/fleet/agents' }, { label: 'fleet.settlements', href: '/fleet/settlements' }] },
  { label: 'fleet.people', href: '/fleet/people' },
  { label: 'fleet.vehicles', href: '/fleet/vehicles' },
  { label: 'fleet.requests', href: '/fleet/requests' },
  { label: 'fleet.routes', href: '/fleet/routes' },
  { label: 'fleet.compliance', href: '/fleet/compliance' },
];

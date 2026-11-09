import type { MenuItem } from '@/shell/AppShell';

/** Shiply menu (UI.md Step 3d, with Agents moved to Agents & Fleet). */
export const SHIPLY_MENU: MenuItem[] = [
  { label: 'shiply.overview', href: '/shiply' },
  { label: 'shiply.parcels', href: '/shiply/parcels' },
  { label: 'shiply.pickups', href: '/shiply/pickups' },
  { label: 'shiply.facilities', items: [{ label: 'shiply.inbound', href: '/shiply/inbound' }, { label: 'shiply.stuck', href: '/shiply/stuck' }, { label: 'shiply.bagsCars', href: '/shiply/bags' }] },
  { label: 'shiply.hubs', items: [{ label: 'shiply.receive', href: '/shiply/receive' }, { label: 'shiply.runs', href: '/shiply/runs' }, { label: 'shiply.returns', href: '/shiply/returns' }] },
  { label: 'shiply.couriers', items: [{ label: 'shiply.zones', href: '/shiply/couriers' }] },
  { label: 'shiply.more', items: [{ label: 'shiply.gaps', href: '/shiply/gaps' }, { label: 'shiply.failed', href: '/shiply/attempts' }] },
];

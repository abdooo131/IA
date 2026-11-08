import type { IconName } from '@/parcels/components/Icon';
import type { Me } from '@/parcels/components/Shell';

/**
 * The desk is split into apps, the same way as Shiply Now (Odoo style): a home screen of
 * tiles, and inside each app a short menu bar whose menus open a list of pages. Pages keep
 * their addresses; this file says which app and menu each belongs to and who may open it.
 * Labels are English text, translated through lib/ar*.ts.
 */
export interface AppPage {
  href: string;
  label: string;
  /** Matches only this exact path (an app's home page). */
  exact?: boolean;
  hint?: string;
}
export interface AppMenu {
  label: string;
  pages: AppPage[];
}
export interface AppDef {
  id: AppId;
  name: string;
  description: string;
  icon: IconName;
  /** The tile's color from the brand v2 palette, as in Shiply Now; AppTileIcon picks the ink. */
  color: string;
  menus: AppMenu[];
}

export type AppId = 'operations' | 'hub' | 'workforce' | 'merchants' | 'accounting' | 'system';

/** The hub floor menus depend on the place: a sorting facility has team stations, a last mile hub does not. */
function hubMenus(me: Me | null): AppMenu[] {
  if (me?.role === 'HUB_STAFF' && me.hub && !me.hub.isSorting) {
    return [
      { label: 'Receive', pages: [{ href: '/parcels/hub', label: 'Receive', exact: true }] },
      { label: 'Couriers', pages: [{ href: '/parcels/hub/runs', label: 'Courier runs' }] },
      {
        label: 'Send out',
        pages: [
          {
            href: '/parcels/hub/sort',
            label: 'Send back',
            hint: 'Returns into the bag for the facility',
          },
          { href: '/parcels/hub/trips', label: 'Trips' },
        ],
      },
      {
        label: 'Control',
        pages: [
          { href: '/parcels/hub/check', label: 'Handover check' },
          { href: '/parcels/hub/damage', label: 'Report damage' },
          { href: '/parcels/hub/safe', label: 'Hub safe' },
        ],
      },
    ];
  }
  const team = me?.role === 'HUB_STAFF' ? me.team : null;
  const stations: AppPage[] = [
    { href: '/parcels/hub', label: 'Inbound', exact: true, hint: 'Receive bags and parcels' },
    { href: '/parcels/hub/sort', label: 'Sorting', hint: 'Put each parcel on its lane' },
    { href: '/parcels/hub/trips', label: 'Outbound', hint: 'Bag parcels and load trucks' },
  ];
  const mine = team ? stations.filter((s) => s.label.toUpperCase() === team) : stations;
  const menus: AppMenu[] = [{ label: 'Stations', pages: mine }];
  if (!team) {
    menus.push({
      label: 'Couriers',
      pages: [
        { href: '/parcels/hub/pickups', label: 'Pickups' },
        { href: '/parcels/hub/runs', label: 'Courier runs' },
      ],
    });
  }
  menus.push({
    label: 'Control',
    pages: [
      { href: '/parcels/hub/check', label: 'Handover check' },
      { href: '/parcels/hub/damage', label: 'Report damage' },
      ...(team ? [] : [{ href: '/parcels/hub/safe', label: 'Hub safe' }]),
    ],
  });
  return menus;
}

export function allApps(me: Me | null): AppDef[] {
  return [
    {
      id: 'operations',
      name: 'Operations',
      description: 'Parcels across the network, the day at a glance',
      icon: 'orders',
      color: '#1D4ED8',
      menus: [
        { label: 'Dashboard', pages: [{ href: '/parcels/admin', label: 'Overview', exact: true }] },
        { label: 'Parcels', pages: [{ href: '/parcels/admin/shipments', label: 'Parcels' }] },
        {
          label: 'Control',
          pages: [
            {
              href: '/parcels/admin/alerts',
              label: 'Alerts',
              hint: 'Everything waiting for someone to act',
            },
            {
              href: '/parcels/admin/live',
              label: 'Couriers on the road',
              hint: 'Where each courier is and how far their run is',
            },
            {
              href: '/parcels/admin/attempts',
              label: 'Check failed attempts',
              hint: 'Call the customer and confirm what the courier recorded',
            },
            {
              href: '/parcels/admin/qc',
              label: 'Quality tickets',
              hint: 'Penalties with a waiting time and an appeal',
            },
            {
              href: '/parcels/admin/lost',
              label: 'Lost and damaged',
              hint: 'Parcels in search, losses paid, damage',
            },
          ],
        },
        {
          label: 'Configuration',
          pages: [
            {
              href: '/parcels/admin/network',
              label: 'Network',
              hint: 'Sorting facilities, hubs and areas',
            },
          ],
        },
      ],
    },
    {
      id: 'hub',
      name: 'Hub floor',
      description: 'Inbound, sorting, outbound, couriers and the safe',
      icon: 'scan',
      color: '#0E7490',
      menus: hubMenus(me),
    },
    {
      id: 'workforce',
      name: 'Workforce',
      description: 'Agents, their staff, attendance and vehicles',
      icon: 'courier',
      color: '#BE185D',
      menus: [
        { label: 'Agents', pages: [{ href: '/parcels/admin/agents', label: 'Agents' }] },
        {
          label: 'Attendance',
          pages: [{ href: '/parcels/admin/attendance', label: 'Attendance' }],
        },
        {
          label: 'Vehicle requests',
          pages: [{ href: '/parcels/admin/vehicle-requests', label: 'Vehicle requests' }],
        },
      ],
    },
    {
      id: 'merchants',
      name: 'Merchants',
      description: 'Merchant accounts, prices and pickup facilities',
      icon: 'store',
      color: '#B45309',
      menus: [
        { label: 'Merchants', pages: [{ href: '/parcels/admin/merchants', label: 'Merchants' }] },
        { label: 'Sign ups', pages: [{ href: '/parcels/admin/signups', label: 'Sign ups' }] },
        {
          label: 'Packaging shop',
          pages: [
            {
              href: '/admin/packaging',
              label: 'Products and stock',
              hint: 'Packaging items and stock per store',
            },
            {
              href: '/finance/purchase-orders',
              label: 'Purchase orders',
              hint: 'Buy from suppliers and receive the goods',
            },
          ],
        },
        {
          label: 'Configuration',
          pages: [
            {
              href: '/parcels/admin/price-tiers',
              label: 'Price tiers',
              hint: 'Monthly volume discounts',
            },
          ],
        },
      ],
    },
    {
      id: 'system',
      name: 'Settings',
      description: 'People who sign in, and the business settings',
      icon: 'settings',
      color: '#475569',
      menus: [
        { label: 'Users', pages: [{ href: '/parcels/admin/users', label: 'Users' }] },
        { label: 'Settings', pages: [{ href: '/parcels/admin/settings', label: 'Settings' }] },
        {
          label: 'Messages',
          pages: [
            { href: '/parcels/admin/messages', label: 'Messages', hint: 'SMS and WhatsApp outbox' },
          ],
        },
      ],
    },
  ];
}

/** The apps a person may open: admins every app, hub staff the hub floor. */
export function appsFor(me: Me | null): AppDef[] {
  if (!me) return [];
  const apps = allApps(me);
  if (me.role === 'ADMIN') return apps;
  if (me.role === 'HUB_STAFF') return apps.filter((a) => a.id === 'hub');
  return [];
}

const under = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function pageMatches(page: AppPage, pathname: string) {
  return page.exact ? pathname === page.href : under(pathname, page.href);
}

/** The app and page a path belongs to: the page with the longest matching address wins. */
export function locate(
  apps: AppDef[],
  pathname: string,
): { app: AppDef; page: AppPage | null } | null {
  let best: { app: AppDef; page: AppPage } | null = null;
  for (const app of apps)
    for (const menu of app.menus)
      for (const page of menu.pages)
        if (pageMatches(page, pathname) && (!best || page.href.length > best.page.href.length))
          best = { app, page };
  if (best) return best;
  // A page on no menu still shows its area's app (a parcel inside Parcels, an agent inside Agents).
  if (under(pathname, '/admin/money'))
    return { app: apps.find((a) => a.id === 'accounting') ?? apps[0]!, page: null };
  if (under(pathname, '/hub'))
    return { app: apps.find((a) => a.id === 'hub') ?? apps[0]!, page: null };
  if (apps[0]) return { app: apps[0], page: null };
  return null;
}

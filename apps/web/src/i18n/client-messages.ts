// Which translations reach the browser (review step 4). Server components read the whole
// file on the server; the client provider of each part of the site carries only the
// namespaces its client components use, so a rider's phone or the public tracking page no
// longer downloads all ~10,500 strings (accounting, the SOP texts and admin among them) on
// every page load and every router.refresh(). Each top level route folder wraps its pages in
// <ClientMessages scope="..."> (its layout.tsx; the public site's pages share "site"), and the
// root layout keeps the few words its own error page needs.
//
// client-messages.test.ts follows the imports of every scope's route files and fails when a
// client component uses a namespace its scope does not send (or a scope sends one nobody
// uses): add or remove the namespace here. An entry may be a part of a namespace
// ('finance.cash'), which sends only that part.

export const CLIENT_SCOPES = {
  root: ['common', 'notFound'],
  site: ['common', 'site.contact', 'site.nav', 'site.ticket'],
  admin: [
    'admin.alerts',
    'admin.audit',
    'admin.counts',
    'admin.locations',
    'admin.merchants',
    'admin.productsEdit',
    'admin.settings',
    'admin.shopify',
    'admin.users',
    'admin.zones',
    'apps',
    'attachments',
    'attendance',
    'closeForRider',
    'common',
    'contracts',
    'customers',
    'damage',
    'data',
    'documents',
    'finance',
    'geo',
    'hr',
    'hr1',
    'hr2',
    'hr3',
    'listView',
    'merchant.orders',
    'merchant.shipments',
    'orderDetail',
    'orders',
    'people',
    'purchasing',
    'refill',
    'returns',
    'rider',
    'riderPay',
    'roles',
    'sales',
    'tickets',
    'transfers',
    'weekdays',
    'workflow',
  ],
  finance: [
    'admin.alerts',
    'apps',
    'attachments',
    'basata',
    'cashControl.monthEnd',
    'cashControl.petty',
    'common',
    'documents',
    'finance',
    'forecast',
    'hr1.flags',
    'infoTips',
    'listView',
    'loansFx.fx',
    'loansFx.loans',
    'loansFx.tags',
    'myPay',
    'orders.stages',
    'purchasing',
    'returns.sources',
    'rider.reasons',
    'riderOffices',
    'riderPay',
    'tickets',
    'workflow',
  ],
  merchant: [
    'closeForRider',
    'common',
    'contracts',
    'customers',
    'damage',
    'finance',
    'merchant.delivery',
    'merchant.new',
    'merchant.notifications',
    'merchant.orders',
    'merchant.shipments',
    'merchant.shopify',
    'merchant.team',
    'merchantFinance',
    'orderDetail',
    'orders',
    'purchasing.emailSettings',
    'returns',
    'rider',
    'tickets',
    'workflow',
  ],
  store: [
    'attachments',
    'attendance',
    'cashControl.override',
    'cashControl.petty',
    'cashControl.pettyStore',
    'closeForRider',
    'common',
    'damage.causes',
    'finance.cash',
    'orders',
    'returns',
    'rider',
    'riderPay',
    'scan',
    'store.binTypes',
    'store.count',
    'store.damaged',
    'store.errors',
    'store.labels',
    'store.putAway',
    'store.receive',
    'storeCash',
    'tickets',
    'transfers',
    'workflow',
  ],
  rider: [
    'attendance',
    'common',
    'orders',
    'rider',
    'riderBasata',
    'riderPay',
    'riderWallet',
    'tickets',
  ],
  help: ['common', 'tickets'],
  home: ['common', 'tickets'],
  'my-file': ['attendance', 'common', 'finance', 'hr2', 'hr3', 'myPay', 'people', 'tickets'],
  login: ['common', 'login'],
  signup: ['common', 'signup'],
  setup: ['common', 'setupPage'],
  t: ['common', 'tracking'],
  p: ['common', 'proposalPage'],
  shopify: [],
  tickets: ['common', 'roles', 'tickets', 'workflow'],
  notifications: ['common', 'push', 'tickets'],
} as const satisfies Record<string, readonly string[]>;

export type ClientScope = keyof typeof CLIENT_SCOPES;

type Messages = Record<string, unknown>;

/** Only the named namespaces (or parts of one, 'finance.cash') of the messages. */
export function pickMessages(messages: Messages, namespaces: readonly string[]): Messages {
  const out: Messages = {};
  for (const path of namespaces) {
    const parts = path.split('.');
    let from: unknown = messages;
    for (const p of parts) from = (from as Messages | undefined)?.[p];
    if (from === undefined) continue;
    let to = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) to[p] = from;
      else to = (to[p] ??= {}) as Messages;
    });
  }
  return out;
}

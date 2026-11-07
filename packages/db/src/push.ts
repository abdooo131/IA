import type { Prisma } from '@prisma/client';
import {
  type AccessApp,
  type AccessLevel,
  cairoDay,
  dealNumber,
  proposalNumber,
  egpText,
  merchantRightsOf,
  type MerchantRightName,
  type PushLang,
  pushLangOf,
  pushText,
  type PushTextKey,
  type PushType,
  type PushVars,
  stageWords,
  TEAM_ROLES,
} from '@shiplynow/shared';
import { type Db, inTransaction } from './client';
import { getSetting } from './settings';

// Web push notifications (docs/ARCHITECTURE.md, Integrations). The API's PushSender talks to the
// browsers' push services; everything else lives here: who receives what, in which language,
// and making sure each event is sent once however often the dispatcher runs.

// ─── the boundary ───────────────────────────────────────────────────────────────

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the service worker receives and shows. */
export interface PushMessage {
  title: string;
  body: string;
  /** The page opened (or focused) when the notification is tapped */
  url: string;
  /** A newer notification with the same tag replaces the older one on the phone */
  tag: string;
  /** Asks the push service to deliver at once even to a sleeping phone */
  urgent: boolean;
}

/** sent: delivered to the push service; gone: the subscription no longer exists (404, 410). */
export type PushOutcome = 'sent' | 'gone';

/** The push services boundary (HttpPush with the VAPID keys in the API, a fake in tests). */
export interface PushSender {
  /** False without VAPID keys: nothing is sent and the screens hide the switch */
  readonly enabled: boolean;
  /** Throws for any failure other than a subscription that is gone. */
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
}

// ─── sending ────────────────────────────────────────────────────────────────────

export interface PushEvent {
  /** Unique per event and audience: the same key is never sent twice */
  key: string;
  userIds: string[];
  /** The preference it falls under; test reaches every device of the person */
  type: PushType | 'test';
  text: PushTextKey;
  vars?: PushVars;
  url: string;
  tag: string;
  urgent?: boolean;
}

export interface NotifyResult {
  status: 'off' | 'duplicate' | 'done';
  sent: number;
  gone: number;
  failed: number;
}

export interface NotifyOptions {
  /** Called for every failed send (the API reports it as a server error) */
  onError?: (error: unknown) => void | Promise<void>;
  now?: Date;
}

/** Push is on: the sender has its keys and the push.enabled setting is 1. */
export async function pushIsOn(db: Db, sender: Pick<PushSender, 'enabled'>) {
  return sender.enabled && (await getSetting(db, 'push.enabled')) === 1;
}

/** Claims an event key; false when it was already sent (by an earlier run or another instance). */
async function claim(db: Db, key: string) {
  const rows = await db.pushSent.createMany({ data: [{ key }], skipDuplicates: true });
  return rows.count === 1;
}

/**
 * Sends one event to every device of the given people, each in its own language, skipping
 * people who switched the type off and disabled accounts. The event key is claimed first, so
 * a job that runs twice sends nothing twice. A failed send never throws: it is counted on the
 * device and handed to onError; a device the push service says is gone is removed.
 */
export async function notify(
  db: Db,
  sender: PushSender,
  event: PushEvent,
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  const result: NotifyResult = { status: 'done', sent: 0, gone: 0, failed: 0 };
  if (!(await pushIsOn(db, sender))) return { ...result, status: 'off' };
  if (!(await claim(db, event.key))) return { ...result, status: 'duplicate' };
  const userIds = [...new Set(event.userIds)];
  if (userIds.length === 0) return result;
  const off =
    event.type === 'test'
      ? new Set<string>()
      : new Set(
          (
            await db.notificationPreference.findMany({
              where: { userId: { in: userIds }, type: event.type, enabled: false },
              select: { userId: true },
            })
          ).map((p) => p.userId),
        );
  const devices = await db.pushSubscription.findMany({
    where: {
      userId: { in: userIds.filter((id) => !off.has(id)) },
      user: { isActive: true },
    },
  });
  const now = options.now ?? new Date();
  await Promise.all(
    devices.map(async (d) => {
      const lang: PushLang = pushLangOf(d.lang);
      const message: PushMessage = {
        ...pushText(event.text, lang, event.vars),
        url: event.url,
        tag: event.tag,
        urgent: event.urgent ?? false,
      };
      try {
        const outcome = await sender.send(
          { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
          message,
        );
        if (outcome === 'gone') {
          result.gone++;
          await db.pushSubscription.deleteMany({ where: { id: d.id } });
        } else {
          result.sent++;
          await db.pushSubscription.updateMany({
            where: { id: d.id },
            data: { lastSuccessAt: now, failures: 0 },
          });
        }
      } catch (error) {
        result.failed++;
        await db.pushSubscription
          .updateMany({
            where: { id: d.id },
            data: { failures: { increment: 1 }, lastFailureAt: now },
          })
          .catch(() => undefined);
        await Promise.resolve(options.onError?.(error)).catch(() => undefined);
      }
    }),
  );
  await db.pushSent
    .update({ where: { key: event.key }, data: { recipients: result.sent } })
    .catch(() => undefined);
  return result;
}

// ─── who receives what ──────────────────────────────────────────────────────────

const FROM_LEVEL: Record<Exclude<AccessLevel, 'none'>, AccessLevel[]> = {
  view: ['view', 'use', 'manage'],
  use: ['use', 'manage'],
  manage: ['manage'],
};

/**
 * Active team members whose access reaches `level` in `app`, limited to people who work in
 * `storeId` (all stores or that store listed) and, for account managers, to their merchants.
 */
export async function teamWith(
  db: Db,
  app: AccessApp,
  level: Exclude<AccessLevel, 'none'>,
  scope: { storeId?: string | null; merchantId?: string | null } = {},
): Promise<string[]> {
  const where = {
    [app]: { in: FROM_LEVEL[level] },
    user: { isActive: true, role: { in: [...TEAM_ROLES] } },
    ...(scope.storeId && {
      OR: [
        { allStores: true },
        { user: { accessStores: { some: { darkStoreId: scope.storeId } } } },
      ],
    }),
  } as Prisma.UserAccessWhereInput;
  const rows = await db.userAccess.findMany({
    where,
    select: {
      userId: true,
      ownMerchantsOnly: true,
      user: { select: { merchantsManaged: { select: { id: true } } } },
    },
  });
  return rows
    .filter(
      (r) =>
        !scope.merchantId ||
        !r.ownMerchantsOnly ||
        r.user.merchantsManaged.some((m) => m.id === scope.merchantId),
    )
    .map((r) => r.userId);
}

/** Active users of a merchant who hold `right` (owners hold every right). */
export async function merchantUsersWith(db: Db, merchantId: string, right: MerchantRightName) {
  const users = await db.user.findMany({
    where: { merchantId, role: 'merchant', isActive: true },
    select: { id: true, merchantRole: true, merchantRights: true },
  });
  return users.filter((u) => merchantRightsOf(u).includes(right)).map((u) => u.id);
}

// ─── the dispatcher ─────────────────────────────────────────────────────────────

/** Events older than this are not notified any more (a late push only confuses). */
export const PUSH_LOOKBACK_MS = 15 * 60_000;
/** Sent keys are kept this long, well past the lookback. */
const SENT_RETENTION_MS = 2 * 24 * 60 * 60_000;

/** Alert types worth paging admins and operations managers about. */
export const PAGING_ALERTS = [
  'server_error',
  'late',
  'delivery_failed',
  'goods_not_returned',
  'cod_mismatch',
  'item_missing',
  'shopify_sync_failed',
  'transfer_short_sent',
  'transfer_short_received',
] as const;

interface Candidate {
  key: string;
  /** Builds the event (recipients included); null when there is nobody or nothing to say */
  make: () => Promise<Omit<PushEvent, 'key'> | null>;
}

type Named = { nameEn: string; nameAr: string };
const named = (x: Named | null | undefined) => (x ? { en: x.nameEn, ar: x.nameAr } : '');
const without = (ids: string[], ...drop: (string | null | undefined)[]) =>
  ids.filter((id) => !drop.includes(id));

export interface DispatchResult {
  candidates: number;
  events: number;
  sent: number;
  gone: number;
  failed: number;
}

/**
 * Looks at what happened in the last 15 minutes (new orders, alerts, shipments and transfers
 * on their way, orders handed to riders, approvals, cash differences, tickets, attendance,
 * merchant orders, payouts and low stock) and notifies the people concerned. It changes no
 * business record and every event has its own key, so it is safe to run as often as wanted,
 * from several instances at once.
 */
export async function dispatchPush(
  db: Db,
  sender: PushSender,
  options: NotifyOptions = {},
): Promise<DispatchResult> {
  const now = options.now ?? new Date();
  const result: DispatchResult = { candidates: 0, events: 0, sent: 0, gone: 0, failed: 0 };
  if (!(await pushIsOn(db, sender))) return result;
  await db.pushSent.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - SENT_RETENTION_MS) } },
  });
  const since = new Date(now.getTime() - PUSH_LOOKBACK_MS);
  const sources = [
    newOrders,
    alertEvents,
    stockArriving,
    riderOrders,
    financeEvents,
    ticketEvents,
    attendanceEvents,
    merchantEvents,
    lowStock,
    crmEvents,
  ];
  for (const source of sources) {
    const candidates = await source(db, since, now);
    if (candidates.length === 0) continue;
    result.candidates += candidates.length;
    const done = new Set(
      (
        await db.pushSent.findMany({
          where: { key: { in: candidates.map((c) => c.key) } },
          select: { key: true },
        })
      ).map((r) => r.key),
    );
    for (const c of candidates) {
      if (done.has(c.key)) continue;
      const event = await c.make();
      if (!event || event.userIds.length === 0) continue;
      const sent = await notify(db, sender, { ...event, key: c.key }, { ...options, now });
      if (sent.status !== 'done') continue;
      result.events++;
      result.sent += sent.sent;
      result.gone += sent.gone;
      result.failed += sent.failed;
    }
  }
  return result;
}

type Source = (db: Db, since: Date, now: Date) => Promise<Candidate[]>;

/** Store staff: a new order to accept (orders queued while closed: once the store opens). */
const newOrders: Source = async (db, since, now) => {
  const orders = await db.order.findMany({
    where: {
      status: 'new',
      OR: [
        { createdAt: { gte: since }, OR: [{ slaStartsAt: null }, { slaStartsAt: { lte: now } }] },
        { slaStartsAt: { gte: since, lte: now } },
      ],
    },
    select: {
      id: true,
      number: true,
      darkStoreId: true,
      darkStore: { select: { nameEn: true, nameAr: true } },
    },
    take: 200,
  });
  return orders.map((o) => ({
    key: `order_new:${o.id}`,
    make: async () => ({
      userIds: await teamWith(db, 'store', 'use', { storeId: o.darkStoreId }),
      type: 'order_new',
      text: 'order_new',
      vars: { number: o.number, store: named(o.darkStore) },
      url: `/store/${o.darkStoreId}/orders/${o.id}`,
      tag: `order-${o.id}`,
      urgent: true,
    }),
  }));
};

/** Alerts: late orders to the store, paging alerts to operations, sign ups, documents, account managers. */
const alertEvents: Source = async (db, since) => {
  const alerts = await db.alert.findMany({
    where: { createdAt: { gte: since }, resolvedAt: null },
    select: {
      id: true,
      type: true,
      stage: true,
      data: true,
      darkStoreId: true,
      merchantId: true,
      orderId: true,
      darkStore: { select: { nameEn: true, nameAr: true } },
      merchant: { select: { name: true, accountManagerId: true } },
      order: {
        select: {
          number: true,
          merchantId: true,
          darkStoreId: true,
          darkStore: { select: { nameEn: true, nameAr: true } },
          merchant: { select: { accountManagerId: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  const list: Candidate[] = [];
  for (const a of alerts) {
    const data = (a.data ?? {}) as Record<string, unknown>;
    const storeId = a.darkStoreId ?? a.order?.darkStoreId ?? null;
    const store = named(a.darkStore ?? a.order?.darkStore);
    const merchantId = a.merchantId ?? a.order?.merchantId ?? null;
    const vars: PushVars = {
      number: a.order?.number ?? String(data.number ?? data.reference ?? ''),
      reference: String(data.reference ?? ''),
      store,
      stage: stageWords(a.stage),
      message: String(data.message ?? data.source ?? ''),
    };
    const storeUsers = () => teamWith(db, 'store', 'use', { storeId });
    if (a.type === 'late' && a.orderId) {
      list.push({
        key: `alert:${a.id}:store`,
        make: async () => ({
          userIds: await storeUsers(),
          type: 'order_late',
          text: 'order_late',
          vars,
          url: `/store/${storeId}/orders/${a.orderId}`,
          tag: `order-${a.orderId}`,
          urgent: true,
        }),
      });
    }
    const paging = (PAGING_ALERTS as readonly string[]).includes(a.type);
    if (paging) {
      list.push({
        key: `alert:${a.id}:ops`,
        make: async () => {
          const ops = await teamWith(db, 'operations', 'manage', { storeId, merchantId });
          // Store staff already heard about their late order.
          const skip = a.type === 'late' ? new Set(await storeUsers()) : new Set<string>();
          return {
            userIds: ops.filter((id) => !skip.has(id)),
            type: 'ops_alert',
            text: alertText(a.type),
            vars,
            url: a.orderId ? `/admin/orders/${a.orderId}` : '/admin/alerts',
            tag: a.orderId ? `order-${a.orderId}` : `alert-${a.type}`,
            urgent: a.type === 'server_error' || a.type === 'late',
          };
        },
      });
      const managerId = a.merchant?.accountManagerId ?? a.order?.merchant.accountManagerId;
      if (managerId)
        list.push({
          key: `alert:${a.id}:am`,
          make: async () => {
            const ops = new Set(
              await teamWith(db, 'operations', 'manage', { storeId, merchantId }),
            );
            const allowed = await teamWith(db, 'merchants', 'use', { merchantId });
            if (ops.has(managerId) || !allowed.includes(managerId)) return null;
            return {
              userIds: [managerId],
              type: 'merchant_alert',
              text: alertText(a.type),
              vars,
              url: '/admin/alerts',
              tag: a.orderId ? `order-${a.orderId}` : `alert-${a.type}`,
            };
          },
        });
    }
    if (a.type === 'rider_cash_overdue' && storeId) {
      // Store managers (to collect it) and finance (to follow it up), each once.
      const cashVars: PushVars = {
        rider: String(data.rider ?? ''),
        store,
        amount: String(data.amountEgp ?? ''),
        hours: String(data.hours ?? ''),
      };
      const managers = () => teamWith(db, 'store', 'manage', { storeId });
      list.push({
        key: `alert:${a.id}:store`,
        make: async () => ({
          userIds: await managers(),
          type: 'rider_cash_overdue',
          text: 'rider_cash_overdue',
          vars: cashVars,
          url: `/store/${storeId}/cash`,
          tag: `rider-cash-${String(data.riderId ?? a.id)}`,
        }),
      });
      list.push({
        key: `alert:${a.id}:finance`,
        make: async () => {
          const skip = new Set(await managers());
          return {
            userIds: (await teamWith(db, 'accounting', 'use', { storeId })).filter(
              (id) => !skip.has(id),
            ),
            type: 'rider_cash_overdue',
            text: 'rider_cash_overdue',
            vars: cashVars,
            url: '/finance/cash-position',
            tag: `rider-cash-${String(data.riderId ?? a.id)}`,
          };
        },
      });
    }
    if (a.type === 'merchant_signup') {
      list.push({
        key: `alert:${a.id}:signup`,
        make: async () => ({
          userIds: await teamWith(db, 'merchants', 'manage'),
          type: 'merchant_signup',
          text: 'merchant_signup',
          vars: { name: a.merchant?.name ?? String(data.name ?? data.merchantName ?? '') },
          url: '/admin/merchants',
          tag: `signup-${a.id}`,
        }),
      });
    }
    // Sales CRM (docs/SALES.md): website leads to the sales managers' queue (or the rep the
    // round robin gave it to), overdue follow ups and stale deals to their owner.
    if (a.type === 'site_lead') {
      list.push({
        key: `alert:${a.id}:lead`,
        make: async () => {
          const dealId = typeof data.dealId === 'string' ? data.dealId : null;
          const deal = dealId
            ? await db.crmDeal.findUnique({ where: { id: dealId }, select: { ownerId: true } })
            : null;
          return {
            userIds: deal?.ownerId
              ? await salesCanOpen(db, [deal.ownerId])
              : await teamWith(db, 'sales', 'manage'),
            type: 'site_lead',
            text: 'site_lead',
            vars: { name: String(data.name ?? '') },
            url: dealId ? `/admin/sales/deals/${dealId}` : '/admin/sales/leads',
            tag: `lead-${a.id}`,
          };
        },
      });
    }
    if (a.type === 'crm_followup_overdue' || a.type === 'crm_deal_stale') {
      const stale = a.type === 'crm_deal_stale';
      list.push({
        key: `alert:${a.id}:crm`,
        make: async () => {
          const ownerId = typeof data.ownerId === 'string' ? data.ownerId : null;
          const dealId = typeof data.dealId === 'string' ? data.dealId : null;
          return {
            userIds: ownerId
              ? await salesCanOpen(db, [ownerId])
              : await teamWith(db, 'sales', 'manage'),
            type: 'crm_followup',
            text: stale ? 'crm_deal_stale' : 'crm_followup_overdue',
            vars: {
              number: String(data.number ?? ''),
              company: String(data.company ?? ''),
              subject: String(data.subject ?? ''),
              minutes: String(data.minutes ?? ''),
              days: String(data.days ?? ''),
            },
            url: dealId ? `/admin/sales/deals/${dealId}` : '/admin/sales/my-day',
            tag: stale ? `crm-deal-${dealId}` : `crm-activity-${String(data.activityId ?? a.id)}`,
          };
        },
      });
    }
    if (a.type === 'document_expiring' || a.type === 'document_expired') {
      const expired = a.type === 'document_expired';
      const docVars: PushVars = {
        document:
          data.typeNameEn || data.typeNameAr
            ? {
                en: String(data.typeNameEn ?? data.typeNameAr),
                ar: String(data.typeNameAr ?? data.typeNameEn),
              }
            : data.kind === 'national_id'
              ? { en: 'National ID', ar: 'بطاقة الرقم القومي' }
              : String(data.title ?? ''),
        date: String(data.expiresOn ?? ''),
        person: { en: String(data.nameEn ?? ''), ar: String(data.nameAr ?? data.nameEn ?? '') },
      };
      const employee = data.employeeId
        ? await db.employee.findUnique({
            where: { id: String(data.employeeId) },
            select: { userId: true },
          })
        : null;
      if (employee)
        list.push({
          key: `alert:${a.id}:self`,
          make: async () => ({
            userIds: [employee.userId],
            type: 'document_expiring',
            text: expired ? 'document_expired_self' : 'document_expiring_self',
            vars: docVars,
            url: '/my-file',
            tag: `document-${a.id}`,
          }),
        });
      list.push({
        key: `alert:${a.id}:hr`,
        make: async () => ({
          userIds: without(await teamWith(db, 'hr', 'use', { storeId }), employee?.userId),
          type: 'document_expiring',
          text: expired ? 'document_expired_hr' : 'document_expiring_hr',
          vars: docVars,
          url: '/admin/hr/documents',
          tag: `document-${a.id}`,
        }),
      });
    }
  }
  return list;
};

function alertText(type: string): PushTextKey {
  switch (type) {
    case 'late':
      return 'alert_late';
    case 'server_error':
      return 'alert_server_error';
    case 'delivery_failed':
      return 'alert_delivery_failed';
    case 'goods_not_returned':
      return 'alert_goods_not_returned';
    case 'cod_mismatch':
      return 'alert_cod_mismatch';
    case 'item_missing':
      return 'alert_item_missing';
    case 'shopify_sync_failed':
      return 'alert_shopify_sync_failed';
    default:
      return 'alert_transfer_short';
  }
}

/** Store staff: a merchant's shipment expected at their location, a transfer sent to them. */
const stockArriving: Source = async (db, since) => {
  const [manifests, transfers] = await Promise.all([
    db.inboundManifest.findMany({
      where: { createdAt: { gte: since }, status: 'expected' },
      select: {
        id: true,
        reference: true,
        darkStoreId: true,
        darkStore: { select: { nameEn: true, nameAr: true } },
        merchant: { select: { name: true } },
      },
      take: 200,
    }),
    db.transfer.findMany({
      where: { sentAt: { gte: since }, status: 'in_transit' },
      select: {
        id: true,
        reference: true,
        toId: true,
        to: { select: { nameEn: true, nameAr: true } },
        from: { select: { nameEn: true, nameAr: true } },
      },
      take: 200,
    }),
  ]);
  return [
    ...manifests.map((m) => ({
      key: `shipment:${m.id}`,
      make: async () => ({
        userIds: await teamWith(db, 'store', 'use', { storeId: m.darkStoreId }),
        type: 'stock_arriving' as const,
        text: 'shipment_arriving' as const,
        vars: { reference: m.reference, merchant: m.merchant.name, store: named(m.darkStore) },
        url: `/store/${m.darkStoreId}/receive/${m.id}`,
        tag: `shipment-${m.id}`,
      }),
    })),
    ...transfers.map((t) => ({
      key: `transfer_sent:${t.id}`,
      make: async () => ({
        userIds: await teamWith(db, 'store', 'use', { storeId: t.toId }),
        type: 'stock_arriving' as const,
        text: 'transfer_arriving' as const,
        vars: { reference: t.reference, from: named(t.from), store: named(t.to) },
        url: `/store/${t.toId}/transfers/${t.id}`,
        tag: `transfer-${t.id}`,
      }),
    })),
  ];
};

/** Riders: an order handed to them at the store. */
const riderOrders: Source = async (db, since) => {
  const deliveries = await db.delivery.findMany({
    where: { assignedAt: { gte: since }, status: { in: ['assigned', 'picked_up'] } },
    select: {
      id: true,
      tripId: true,
      rider: { select: { userId: true } },
      order: { select: { number: true } },
    },
    take: 200,
  });
  return deliveries.map((d) => ({
    key: `rider_order:${d.id}`,
    make: async () => ({
      userIds: [d.rider.userId],
      type: 'rider_order',
      text: 'rider_order',
      vars: { number: d.order.number },
      url: '/rider',
      tag: `trip-${d.tripId ?? d.id}`,
      urgent: true,
    }),
  }));
};

/** Finance: requests and payouts waiting for a second person, cash handover differences. */
const financeEvents: Source = async (db, since) => {
  const threshold = await getSetting(db, 'finance.approval_threshold_piastres');
  const [requests, payouts, handovers] = await Promise.all([
    db.financeRequest.findMany({
      where: { createdAt: { gte: since }, status: 'pending' },
      select: {
        id: true,
        amountPiastres: true,
        requestedById: true,
        requestedBy: { select: { name: true } },
      },
      take: 100,
    }),
    threshold > 0
      ? db.payout.findMany({
          where: {
            createdAt: { gte: since },
            status: 'draft',
            approvedById: null,
            amountPiastres: { gte: threshold },
          },
          select: {
            id: true,
            number: true,
            amountPiastres: true,
            createdById: true,
            merchant: { select: { name: true } },
          },
          take: 100,
        })
      : Promise.resolve([]),
    db.cashHandover.findMany({
      where: { createdAt: { gte: since }, differencePiastres: { not: 0 } },
      select: {
        id: true,
        number: true,
        darkStoreId: true,
        differencePiastres: true,
        darkStore: { select: { nameEn: true, nameAr: true } },
        rider: { select: { user: { select: { name: true } } } },
      },
      take: 100,
    }),
  ]);
  return [
    ...requests.map((r) => ({
      key: `finance_request:${r.id}`,
      make: async () => ({
        userIds: without(await teamWith(db, 'accounting', 'use'), r.requestedById),
        type: 'finance_approval' as const,
        text: 'finance_request' as const,
        vars: { amount: egpText(r.amountPiastres), name: r.requestedBy.name },
        url: '/finance/approvals',
        tag: `finance-request-${r.id}`,
      }),
    })),
    ...payouts.map((p) => ({
      key: `payout_approval:${p.id}`,
      make: async () => ({
        userIds: without(await teamWith(db, 'accounting', 'use'), p.createdById),
        type: 'finance_approval' as const,
        text: 'payout_approval' as const,
        vars: {
          number: `PAY-${String(p.number).padStart(6, '0')}`,
          merchant: p.merchant.name,
          amount: egpText(p.amountPiastres),
        },
        url: '/finance/payouts',
        tag: `payout-${p.id}`,
      }),
    })),
    ...handovers.map((h) => ({
      key: `cash_difference:${h.id}`,
      make: async () => ({
        userIds: await teamWith(db, 'accounting', 'use', { storeId: h.darkStoreId }),
        type: 'cash_difference' as const,
        text: 'cash_difference' as const,
        vars: {
          number: `CH-${String(h.number).padStart(6, '0')}`,
          rider: h.rider.user.name,
          store: named(h.darkStore),
          amount: egpText(Math.abs(h.differencePiastres)),
        },
        url: '/finance/cash',
        tag: `handover-${h.id}`,
      }),
    })),
  ];
};

/** Tickets: a new ticket to its assignee, a reply to the other person on it. */
const ticketEvents: Source = async (db, since) => {
  const messages = await db.ticketMessage.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true,
      authorId: true,
      authorName: true,
      body: true,
      createdAt: true,
      ticket: {
        select: {
          id: true,
          number: true,
          title: true,
          createdById: true,
          assigneeId: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  return messages.map((m) => {
    const t = m.ticket;
    const opening = m.createdAt.getTime() === t.createdAt.getTime() && m.authorId === t.createdById;
    const number = `TCK-${String(t.number).padStart(6, '0')}`;
    return {
      key: `ticket_message:${m.id}`,
      make: async () => ({
        userIds: opening
          ? [t.assigneeId]
          : without([...new Set([t.createdById, t.assigneeId])], m.authorId),
        type: 'ticket' as const,
        text: opening ? ('ticket_new' as const) : ('ticket_reply' as const),
        vars: { number, title: t.title, name: m.authorName, body: m.body },
        url: `/tickets/${t.id}`,
        tag: `ticket-${t.id}`,
      }),
    };
  });
};

/** A person's own attendance day closed as late. */
const attendanceEvents: Source = async (db, since) => {
  const days = await db.attendanceDay.findMany({
    where: { closedAt: { gte: since }, status: 'late' },
    select: { id: true, day: true, lateMinutes: true, employee: { select: { userId: true } } },
    take: 300,
  });
  return days.map((d) => ({
    key: `attendance_late:${d.id}`,
    make: async () => ({
      userIds: [d.employee.userId],
      type: 'attendance_late',
      text: 'attendance_late',
      vars: { minutes: d.lateMinutes, day: d.day.toISOString().slice(0, 10) },
      url: '/my-file',
      tag: `attendance-${d.id}`,
    }),
  }));
};

/** Merchant users: orders delivered or failed (orders right), payouts paid (money right). */
const merchantEvents: Source = async (db, since) => {
  const [notes, payouts] = await Promise.all([
    db.notification.findMany({
      where: {
        createdAt: { gte: since },
        type: { in: ['order_delivered', 'order_attempt_failed', 'order_failed'] },
      },
      select: { id: true, merchantId: true, type: true, data: true },
      take: 300,
    }),
    db.payout.findMany({
      where: { paidAt: { gte: since }, status: 'paid' },
      select: { id: true, number: true, merchantId: true, amountPiastres: true },
      take: 100,
    }),
  ]);
  return [
    ...notes.map((n) => {
      const data = (n.data ?? {}) as { orderId?: string; number?: string };
      return {
        key: `merchant_note:${n.id}`,
        make: async () => ({
          userIds: await merchantUsersWith(db, n.merchantId, 'orders'),
          type: 'merchant_order' as const,
          text: `merchant_${n.type}` as PushTextKey,
          vars: { number: data.number ?? '' },
          url: data.orderId ? `/merchant/orders/${data.orderId}` : '/merchant/orders',
          tag: `order-${data.orderId ?? n.id}`,
        }),
      };
    }),
    ...payouts.map((p) => ({
      key: `payout_paid:${p.id}`,
      make: async () => ({
        userIds: await merchantUsersWith(db, p.merchantId, 'money'),
        type: 'merchant_payout' as const,
        text: 'merchant_payout_paid' as const,
        vars: {
          number: `PAY-${String(p.number).padStart(6, '0')}`,
          amount: egpText(p.amountPiastres),
        },
        url: '/merchant/wallet',
        tag: `payout-${p.id}`,
      }),
    })),
  ];
};

/**
 * Merchant users with the stock right: a product whose sellable units at a dark store fell to
 * stock.low_stock_threshold or below, once per product, store and Cairo day.
 */
const lowStock: Source = async (db, since, now) => {
  const levels = await db.stockLevel.findMany({
    where: { updatedAt: { gte: since }, darkStore: { kind: 'dark_store', isActive: true } },
    select: {
      darkStoreId: true,
      skuId: true,
      onHand: true,
      reserved: true,
      darkStore: { select: { nameEn: true, nameAr: true } },
      sku: { select: { merchantId: true, titleEn: true, titleAr: true } },
    },
    take: 500,
  });
  const rules = new Map<string, { buffer: number; threshold: number }>();
  const day = cairoDay(now);
  const list: Candidate[] = [];
  for (const l of levels) {
    let rule = rules.get(l.darkStoreId);
    if (!rule) {
      rule = {
        buffer: await getSetting(db, 'stock.buffer_units', l.darkStoreId),
        threshold: await getSetting(db, 'stock.low_stock_threshold', l.darkStoreId),
      };
      rules.set(l.darkStoreId, rule);
    }
    const available = Math.max(l.onHand - l.reserved - rule.buffer, 0);
    if (available > rule.threshold) continue;
    list.push({
      key: `low_stock:${l.darkStoreId}:${l.skuId}:${day}`,
      make: async () => ({
        userIds: await merchantUsersWith(db, l.sku.merchantId, 'stock'),
        type: 'merchant_low_stock',
        text: 'merchant_low_stock',
        vars: {
          product: { en: l.sku.titleEn, ar: l.sku.titleAr },
          available,
          store: named(l.darkStore),
        },
        url: '/merchant/products',
        tag: `stock-${l.darkStoreId}-${l.skuId}`,
      }),
    });
  }
  return list;
};

// ─── a person's devices and switches ───────────────────────────────────────────

/** Adds a device, or takes it over when the same browser was used by someone else before. */
export function savePushSubscription(
  db: Db,
  input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    lang?: PushLang;
    userAgent?: string | null;
    /** The endpoint this one replaces on the same browser (only the person's own) */
    replaces?: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const old =
      input.replaces && input.replaces !== input.endpoint
        ? await tx.pushSubscription.findFirst({
            where: { endpoint: input.replaces, userId: input.userId },
          })
        : null;
    if (old) await tx.pushSubscription.delete({ where: { id: old.id } });
    const lang = input.lang ?? (old ? pushLangOf(old.lang) : undefined);
    const data = {
      userId: input.userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      ...(lang && { lang }),
    };
    return tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { ...data, endpoint: input.endpoint },
      update: { ...data, failures: 0 },
    });
  });
}

export async function listPushDevices(db: Db, userId: string) {
  const rows = await db.pushSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((d) => ({
    id: d.id,
    endpoint: d.endpoint,
    userAgent: d.userAgent,
    lang: pushLangOf(d.lang),
    createdAt: d.createdAt.toISOString(),
    lastSuccessAt: d.lastSuccessAt?.toISOString() ?? null,
    failures: d.failures,
  }));
}

/** The person's switches: every type is on unless they switched it off. */
export async function pushPreferences(db: Db, userId: string, types: readonly PushType[]) {
  const rows = await db.notificationPreference.findMany({ where: { userId } });
  const off = new Set(rows.filter((r) => !r.enabled).map((r) => r.type));
  return types.map((type) => ({ type, enabled: !off.has(type) }));
}

export function setPushPreference(db: Db, userId: string, type: PushType, enabled: boolean) {
  return db.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, enabled },
    update: { enabled },
  });
}

/** The given people who may still open sales records (an owner who lost sales access hears nothing). */
async function salesCanOpen(db: Db, userIds: string[]) {
  const allowed = new Set(await teamWith(db, 'sales', 'view'));
  return userIds.filter((id) => allowed.has(id));
}

/**
 * Sales CRM: a deal given to a rep (by a manager or the round robin), a new lead waiting in the
 * managers' queue (website leads are told through their alert) and a follow up that just became
 * due (marked by the reminder job).
 */
const crmEvents: Source = async (db, since) => {
  const list: Candidate[] = [];
  const assigned = await db.crmDeal.findMany({
    where: { ownerAssignedAt: { gte: since }, ownerId: { not: null } },
    select: {
      id: true,
      number: true,
      ownerId: true,
      ownerAssignedAt: true,
      ownerAssignedById: true,
      company: { select: { brandName: true } },
    },
    take: 200,
  });
  for (const d of assigned) {
    if (d.ownerAssignedById === d.ownerId) continue;
    list.push({
      key: `crm_assigned:${d.id}:${d.ownerAssignedAt!.getTime()}`,
      make: async () => {
        const by = d.ownerAssignedById
          ? await db.user.findUnique({
              where: { id: d.ownerAssignedById },
              select: { name: true },
            })
          : null;
        return {
          userIds: await salesCanOpen(db, [d.ownerId!]),
          type: 'crm_lead',
          text: 'crm_lead_assigned',
          vars: {
            number: dealNumber(d.number),
            company: d.company.brandName,
            name: by?.name ?? 'Shiply',
          },
          url: `/admin/sales/deals/${d.id}`,
          tag: `crm-deal-${d.id}`,
        };
      },
    });
  }
  const queued = await db.crmDeal.findMany({
    where: {
      createdAt: { gte: since },
      ownerId: null,
      company: { source: { not: 'website_form' } },
    },
    select: { id: true, company: { select: { brandName: true } } },
    take: 200,
  });
  for (const d of queued)
    list.push({
      key: `crm_lead_new:${d.id}`,
      make: async () => ({
        userIds: await teamWith(db, 'sales', 'manage'),
        type: 'crm_lead',
        text: 'crm_lead_new',
        vars: { company: d.company.brandName },
        url: `/admin/sales/deals/${d.id}`,
        tag: `crm-deal-${d.id}`,
      }),
    });
  const due = await db.crmActivity.findMany({
    where: { dueNotifiedAt: { gte: since }, doneAt: null },
    select: {
      id: true,
      subject: true,
      ownerId: true,
      dealId: true,
      companyId: true,
      company: { select: { brandName: true } },
    },
    take: 300,
  });
  for (const a of due)
    list.push({
      key: `crm_due:${a.id}`,
      make: async () => ({
        userIds: await salesCanOpen(db, [a.ownerId]),
        type: 'crm_followup',
        text: 'crm_followup_due',
        vars: { company: a.company.brandName, subject: a.subject },
        url: a.dealId ? `/admin/sales/deals/${a.dealId}` : `/admin/sales/companies/${a.companyId}`,
        tag: `crm-activity-${a.id}`,
        urgent: true,
      }),
    });
  // Proposals (part 2): a discount waiting for a sales manager, the approval back to the rep,
  // and the brand's answer to the deal's owner.
  const proposals = await db.crmProposal.findMany({
    where: {
      OR: [
        { approvalRequestedAt: { gte: since } },
        { approvedAt: { gte: since } },
        { acceptedAt: { gte: since } },
        { declinedAt: { gte: since } },
      ],
    },
    select: {
      id: true,
      number: true,
      dealId: true,
      createdById: true,
      maxDiscountBp: true,
      approvalRequestedAt: true,
      approvedAt: true,
      acceptedAt: true,
      declinedAt: true,
      signerName: true,
      createdBy: { select: { name: true } },
      deal: { select: { ownerId: true, company: { select: { brandName: true } } } },
    },
    take: 200,
  });
  for (const p of proposals) {
    const base = {
      type: 'crm_proposal' as const,
      url: `/admin/sales/deals/${p.dealId}#proposals`,
      tag: `crm-proposal-${p.id}`,
    };
    const vars = {
      number: proposalNumber(p.number),
      company: p.deal.company.brandName,
      name: p.signerName ?? p.createdBy.name,
      discount: (p.maxDiscountBp / 100).toFixed(p.maxDiscountBp % 100 ? 2 : 0),
    };
    const owner = p.deal.ownerId ?? p.createdById;
    if (p.approvalRequestedAt && p.approvalRequestedAt >= since && !p.approvedAt)
      list.push({
        key: `crm_proposal_approval:${p.id}:${p.approvalRequestedAt.getTime()}`,
        make: async () => ({
          ...base,
          userIds: (await teamWith(db, 'sales', 'manage')).filter((id) => id !== p.createdById),
          text: 'crm_proposal_approval',
          vars: { ...vars, name: p.createdBy.name },
        }),
      });
    if (p.approvedAt && p.approvedAt >= since)
      list.push({
        key: `crm_proposal_approved:${p.id}`,
        make: async () => ({
          ...base,
          userIds: await salesCanOpen(db, [p.createdById]),
          text: 'crm_proposal_approved',
          vars,
        }),
      });
    if (p.acceptedAt && p.acceptedAt >= since)
      list.push({
        key: `crm_proposal_accepted:${p.id}`,
        make: async () => ({
          ...base,
          userIds: await salesCanOpen(db, [owner]),
          text: 'crm_proposal_accepted',
          vars,
          urgent: true,
        }),
      });
    if (p.declinedAt && p.declinedAt >= since)
      list.push({
        key: `crm_proposal_declined:${p.id}`,
        make: async () => ({
          ...base,
          userIds: await salesCanOpen(db, [owner]),
          text: 'crm_proposal_declined',
          vars,
        }),
      });
  }
  return list;
};

// Merchant webhooks. Events are written to a queue in the same transaction as the change, and a
// sender posts them signed, retrying with growing waits. Addresses inside our own network are
// refused, so a webhook cannot be used to reach our servers.
import { STATUS_LABELS, type ShipmentStatus } from '@shiplynow/shared/parcels';
import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { DomainError } from './errors';
import type { PrismaService, Tx } from './prisma.service';

export const WEBHOOK_EVENTS = ['shipment.created', 'shipment.updated', 'shipment.delivered', 'shipment.failed_attempt', 'shipment.returned', 'shipment.cancelled'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Waits between tries: 1 minute, 5 minutes, 30 minutes, 2, 6 and 12 hours. Then it gives up. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720];
/** A webhook that fails this many deliveries in a row is switched off. */
const MAX_FAILURES = 25;

/** The shape every parcel has in the API and in webhooks. */
export function presentParcel(s: {
  trackingNumber: string; merchantRef: string; status: string; kind?: string; direction?: string; customerName: string; customerPhone: string; address: string;
  governorateCode: string; size: string; codAmount: number; codCollected?: number; shippingFee: number; attempts?: number; lastFailReason?: string | null;
  deliverOn?: string | null; promisedDate?: string | null; createdAt: Date | string;
}, trackingBase = '') {
  return {
    trackingNumber: s.trackingNumber,
    merchantRef: s.merchantRef,
    status: s.status,
    statusLabel: STATUS_LABELS[s.status as ShipmentStatus] ?? s.status,
    kind: s.kind ?? 'NORMAL',
    direction: s.direction ?? 'FORWARD',
    customer: { name: s.customerName, phone: s.customerPhone },
    address: s.address,
    governorateCode: s.governorateCode,
    size: s.size,
    codAmount: s.codAmount,
    codCollected: s.codCollected ?? 0,
    shippingFee: s.shippingFee,
    attempts: s.attempts ?? 0,
    failReason: s.lastFailReason ?? null,
    deliverOn: s.deliverOn ?? null,
    promisedDate: s.promisedDate ?? null,
    createdAt: new Date(s.createdAt).toISOString(),
    trackingUrl: trackingBase ? `${trackingBase}/${s.trackingNumber}` : null,
  };
}

function eventsFor(to: string, previous: string | null): WebhookEvent[] {
  const list: WebhookEvent[] = [previous === null ? 'shipment.created' : 'shipment.updated'];
  if (to === 'DELIVERED') list.push('shipment.delivered');
  if (to === 'ATTEMPT_FAILED') list.push('shipment.failed_attempt');
  if (to === 'RETURNED') list.push('shipment.returned');
  if (to === 'CANCELLED') list.push('shipment.cancelled');
  return list;
}

/** Queues the parcel's change for every webhook of the merchant that listens to it. */
export async function queueParcelWebhooks(
  tx: Tx | PrismaService,
  a: { merchantId: string; mode: 'LIVE' | 'TEST'; parcel: Record<string, unknown> & { status: string }; previous: string | null; eventType: string; note?: string },
) {
  const hooks = await tx.webhook.findMany({ where: { merchantId: a.merchantId, mode: a.mode, active: true }, select: { id: true, events: true } });
  if (!hooks.length) return 0;
  const at = new Date().toISOString();
  let queued = 0;
  for (const event of eventsFor(a.parcel.status, a.previous)) {
    for (const h of hooks) {
      if (!h.events.includes('*') && !h.events.includes(event)) continue;
      await tx.webhookDelivery.create({ data: { webhookId: h.id, event, payload: { event, at, mode: a.mode, data: { ...a.parcel, previousStatus: a.previous, eventType: a.eventType, note: a.note ?? '' } } } });
      queued++;
    }
  }
  return queued;
}

/** Real parcels: reads the parcel after the change and queues it. */
export async function queueShipmentWebhooks(tx: Tx, shipmentId: string, previous: string | null, eventType: string, note?: string) {
  const s = await tx.shipment.findUnique({ where: { id: shipmentId } });
  if (!s) return 0;
  const any = await tx.webhook.count({ where: { merchantId: s.merchantId, mode: 'LIVE', active: true } });
  if (!any) return 0;
  const base = await tx.setting.findUnique({ where: { key_scope: { key: 'parcels.tracking.base_url', scope: 'global' } } });
  return queueParcelWebhooks(tx, { merchantId: s.merchantId, mode: 'LIVE', parcel: presentParcel(s, typeof base?.value === 'string' ? base.value : ''), previous, eventType, note });
}

// ---------------------------------------------------------------- addresses we will call

function privateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const allowPrivate = () => process.env.WEBHOOKS_ALLOW_PRIVATE === '1';

/** Checked when a webhook is saved: a full https address that is not inside our network. */
export function checkWebhookUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError('invalid_input', 'Enter a full address, like https://shop.example/shiply', 422);
  }
  if (url.protocol !== 'https:' && !(allowPrivate() && url.protocol === 'http:')) throw new DomainError('invalid_input', 'The address must start with https://', 422);
  if (url.username || url.password) throw new DomainError('invalid_input', 'Do not put a user name or password in the address', 422);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate() && (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) && privateAddress(host)))) {
    throw new DomainError('invalid_input', 'This address is not reachable from the internet', 422);
  }
  return url.toString();
}

/** Checked again just before each call, because a name can point somewhere else later. */
async function resolvesPublic(url: URL) {
  if (allowPrivate()) return true;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  return ips.length > 0 && ips.every((i) => !privateAddress(i.address));
}

export function sign(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Sends one delivery. Returns true when the merchant's server said 2xx. */
export async function sendDelivery(db: PrismaService, id: string) {
  const d = await db.webhookDelivery.findUnique({ where: { id }, include: { webhook: true } });
  if (!d || d.status !== 'PENDING') return false;
  const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
  const t = Math.floor(Date.now() / 1000);
  let code: number | null = null;
  let text = '';
  try {
    const url = new URL(d.webhook.url);
    if (!(await resolvesPublic(url))) throw new Error('The address points inside a private network');
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'user-agent': 'Shiply-Webhooks/1', 'shiply-event': d.event, 'shiply-delivery': d.id, 'shiply-signature': `t=${t},v1=${sign(d.webhook.secret, t, body)}` },
      body,
    });
    code = res.status;
    text = (await res.text().catch(() => '')).slice(0, 500);
  } catch (e) {
    text = (e instanceof Error ? e.message : 'Could not connect').slice(0, 500);
  }
  const ok = code !== null && code >= 200 && code < 300;
  const attempts = d.attempts + 1;
  if (ok) {
    await db.webhookDelivery.update({ where: { id }, data: { status: 'SENT', attempts, responseCode: code, responseBody: text, sentAt: new Date() } });
    await db.webhook.update({ where: { id: d.webhookId }, data: { failures: 0 } });
    return true;
  }
  const wait = BACKOFF_MINUTES[attempts - 1];
  await db.webhookDelivery.update({
    where: { id },
    data: { attempts, responseCode: code, responseBody: text, ...(wait === undefined ? { status: 'FAILED' } : { nextAttemptAt: new Date(Date.now() + wait * 60_000) }) },
  });
  const hook = await db.webhook.update({ where: { id: d.webhookId }, data: { failures: { increment: 1 } } });
  if (hook.failures >= MAX_FAILURES) await db.webhook.update({ where: { id: hook.id }, data: { active: false } });
  return false;
}

/** Sends what is due, a batch at a time. */
export async function sendDueWebhooks(db: PrismaService, limit = 50) {
  const due = await db.webhookDelivery.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, select: { id: true }, orderBy: { nextAttemptAt: 'asc' }, take: limit });
  let sent = 0;
  for (const d of due) if (await sendDelivery(db, d.id)) sent++;
  return { due: due.length, sent };
}

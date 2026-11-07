import type { OrderDetail, OrderStatus } from './order-types';
import { WORKFLOWS } from './workflows';

/** Statuses in which the order is still on its way to the customer. */
export const OPEN_STATUSES: readonly OrderStatus[] = [
  'new',
  'accepted',
  'picking',
  'packed',
  'out_for_delivery',
];

/** One step of the tracking stepper: the order's path with the time each step was reached. */
export interface Step {
  status: string;
  at: string | null;
  state: 'done' | 'current' | 'todo' | 'side';
}

/** When the order reached a status on its path, from the order's stage timestamps. */
function reachedAt(order: OrderDetail, status: string): string | null {
  switch (status) {
    case 'new':
      return order.placedAt;
    case 'accepted':
      return order.acceptedAt;
    case 'picking':
      return order.pickingStartedAt;
    case 'packed':
      return order.packedAt;
    case 'out_for_delivery':
      return order.outForDeliveryAt;
    case 'delivered':
      return order.deliveredAt;
    default:
      return null;
  }
}

/**
 * The stepper: every step of the order path (lib/workflows.ts) with its time; a side state
 * (failed attempt, cancelled, failed, moved to standard) is added in red after the last step
 * reached.
 */
export function orderSteps(order: OrderDetail): Step[] {
  const path = WORKFLOWS.order.path as readonly string[];
  const side = (WORKFLOWS.order.side as readonly string[]).includes(order.status);
  const at = path.indexOf(order.status);
  const steps: Step[] = path.map((status, i) => {
    const time = reachedAt(order, status);
    const state: Step['state'] = side
      ? time
        ? 'done'
        : 'todo'
      : i < at
        ? 'done'
        : i === at
          ? 'current'
          : 'todo';
    return { status, at: time, state };
  });
  if (side) {
    const lastFailed = order.deliveries.find((d) => d.failedAt)?.failedAt ?? null;
    const sideStep: Step = {
      status: order.status,
      at: order.status === 'attempt_failed' ? lastFailed : order.closedAt,
      state: 'side',
    };
    const lastDone = steps.map((s) => s.state).lastIndexOf('done');
    steps.splice(lastDone + 1, 0, sideStep);
  }
  return steps;
}

/** The rider's calls to the customer, newest first, from the order's events. */
export function callLog(order: OrderDetail) {
  return order.events
    .filter((e) => e.type === 'customer_called')
    .map((e) => ({ at: e.at, by: e.by, attempt: Number(e.data?.attempt ?? 0) || null }))
    .reverse();
}

/** Delivery attempts made so far (a rider left with the order), at most the maximum shown. */
export function attemptsMade(order: OrderDetail) {
  return order.deliveries.filter((d) => d.pickedUpAt || d.deliveredAt || d.failedAt).length;
}

/** Whether the promise was kept: on time, late, or still open (null). */
export function promiseOutcome(order: OrderDetail, now = new Date()): 'on_time' | 'late' | null {
  if (!order.slaDueAt) return null;
  const due = new Date(order.slaDueAt).getTime();
  if (order.deliveredAt) return new Date(order.deliveredAt).getTime() <= due ? 'on_time' : 'late';
  if (!OPEN_STATUSES.includes(order.status)) return null;
  return now.getTime() > due || order.stage?.late ? 'late' : 'on_time';
}

export type PhotoKind = 'pack' | 'proof' | 'door';

/** Proof photos of the order: the pack photo, then each delivery's handover or door photo. */
export function orderPhotos(order: OrderDetail) {
  const out: { id: string; kind: PhotoKind; at: string | null }[] = [];
  if (order.packPhotoId) out.push({ id: order.packPhotoId, kind: 'pack', at: order.packedAt });
  for (const d of order.deliveries) {
    if (d.proofPhotoId) out.push({ id: d.proofPhotoId, kind: 'proof', at: d.deliveredAt });
    if (d.failedPhotoId) out.push({ id: d.failedPhotoId, kind: 'door', at: d.failedAt });
  }
  return out;
}

/** Shopify's numeric order id from its global id (gid://shopify/Order/123 → 123). */
export function shopifyRef(id: string | null) {
  if (!id) return null;
  return id.split('/').pop() ?? id;
}

/** The key of the sentence that says where the order is, in plain words. */
export function plainStateKey(order: OrderDetail, now = new Date()) {
  if (
    order.slaStartsAt &&
    new Date(order.slaStartsAt).getTime() > now.getTime() &&
    order.status === 'new'
  )
    return 'waitingOpen';
  return order.status;
}

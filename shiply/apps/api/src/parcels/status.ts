// The parcel statuses kept from the old system, and the only changes allowed between them.

export const STATUSES = [
  'created',
  'picked_up',
  'at_inbound',
  'sorted',
  'at_outbound',
  'in_transit',
  'at_hub',
  'on_hold',
  'out_for_delivery',
  'attempt_failed',
  'delivered',
  'returned',
  'cancelled',
  'lost',
] as const;
export type Status = (typeof STATUSES)[number];

/**
 * Forward: created → picked up → at inbound → sorted → at outbound (bagged) → in transit → at hub
 * → out for delivery → delivered or attempt failed. Returns go back the same way: at hub or on
 * hold → at outbound (return bag) → in transit → at inbound (the merchant's facility) → returned.
 */
export const TRANSITIONS: Record<Status, readonly Status[]> = {
  created: ['picked_up', 'cancelled', 'on_hold', 'lost'],
  picked_up: ['at_inbound', 'on_hold', 'lost'],
  at_inbound: ['sorted', 'returned', 'on_hold', 'lost'],
  sorted: ['at_outbound', 'on_hold', 'lost'],
  at_outbound: ['in_transit', 'on_hold', 'lost'],
  in_transit: ['at_hub', 'at_inbound', 'lost'],
  at_hub: ['out_for_delivery', 'at_outbound', 'on_hold', 'lost'],
  on_hold: ['at_hub', 'at_outbound', 'lost'],
  out_for_delivery: ['delivered', 'attempt_failed', 'at_hub', 'lost'],
  attempt_failed: ['out_for_delivery', 'at_hub', 'on_hold', 'lost'],
  delivered: [],
  returned: [],
  cancelled: [],
  lost: [],
};

export function canMove(from: string, to: string): boolean {
  return (TRANSITIONS[from as Status] ?? []).includes(to as Status);
}

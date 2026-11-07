// Parcel statuses and the only moves allowed between them.
//
// Where a parcel is comes from its status plus one location field:
//   CREATED            with the merchant, waiting for pickup
//   PICKED_UP          in a pickup courier's vehicle (pickupId)
//   AT_HUB / ON_HOLD   inside a hub (currentHubId), maybe in an open or sealed bag (bagId)
//   IN_TRANSIT         in a sealed bag on a line haul trip (bagId, tripId)
//   OUT_FOR_DELIVERY   with a courier on a run (runId)
//   ATTEMPT_FAILED     still with the courier after a failed attempt (runId)
// Direction says where the parcel is heading: FORWARD to the customer, RETURN to the merchant.

export const SHIPMENT_STATUSES = [
  'CREATED',
  'PICKED_UP',
  'AT_HUB',
  'ON_HOLD',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'ATTEMPT_FAILED',
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
  'LOST',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const DIRECTIONS = ['FORWARD', 'RETURN'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const TERMINAL_STATUSES: readonly ShipmentStatus[] = ['DELIVERED', 'RETURNED', 'CANCELLED'];

export const ALLOWED_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  CREATED: ['PICKED_UP', 'AT_HUB', 'CANCELLED'],
  PICKED_UP: ['PICKED_UP', 'AT_HUB', 'LOST'],
  AT_HUB: ['AT_HUB', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ON_HOLD', 'LOST'],
  ON_HOLD: ['AT_HUB', 'ON_HOLD', 'LOST'],
  IN_TRANSIT: ['IN_TRANSIT', 'AT_HUB', 'LOST'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED', 'ATTEMPT_FAILED', 'AT_HUB', 'LOST'],
  ATTEMPT_FAILED: ['AT_HUB', 'ON_HOLD', 'LOST'],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
  LOST: ['AT_HUB'],
};

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ShipmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  CREATED: 'Created',
  PICKED_UP: 'Picked up',
  AT_HUB: 'At hub',
  ON_HOLD: 'On hold',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  ATTEMPT_FAILED: 'Attempt failed',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned to merchant',
  CANCELLED: 'Cancelled',
  LOST: 'Lost',
};

/** Why a delivery attempt failed, and what happens next by default. */
export const FAIL_REASONS = {
  NO_ANSWER: { label: 'Customer did not answer', next: 'REATTEMPT' },
  NOT_AVAILABLE: { label: 'Customer not available', next: 'REATTEMPT' },
  POSTPONED: { label: 'Customer asked for another day', next: 'REATTEMPT' },
  CANNOT_PAY: { label: 'Customer cannot pay now', next: 'REATTEMPT' },
  WRONG_ADDRESS: { label: 'Wrong or incomplete address', next: 'HOLD' },
  WRONG_PHONE: { label: 'Wrong phone number', next: 'HOLD' },
  REFUSED: { label: 'Customer refused the parcel', next: 'HOLD' },
  OTHER: { label: 'Other', next: 'REATTEMPT' },
} as const;
export type FailReason = keyof typeof FAIL_REASONS;
export const FAIL_REASON_CODES = Object.keys(FAIL_REASONS) as FailReason[];

export const PARCEL_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type ParcelSize = (typeof PARCEL_SIZES)[number];

export const ROLES = ['ADMIN', 'HUB_STAFF', 'COURIER', 'MERCHANT'] as const;
export type Role = (typeof ROLES)[number];

// Parcel statuses and the only moves allowed between them.
//
// The company flow: merchant → first mile courier → SORTING FACILITY (inbound team → sorting
// team → outbound team) → line haul → LAST MILE HUB → courier → end consumer.
// Returns run the other way and are handed back to the merchant from their sorting facility.
//
// Where a parcel is comes from its status plus one location field:
//   CREATED            with the merchant, waiting for pickup
//   PICKED_UP          in a first mile courier's vehicle (pickupId)
//   AT_INBOUND         received by a sorting facility's inbound team, waiting for sorting
//   SORTED             sorting team put it on the lane for its next place (laneHubId),
//                      waiting for the outbound team
//   AT_OUTBOUND        outbound team scanned it into a bag (bagId): handover complete
//   IN_TRANSIT         in a bag on a truck (bagId); stays here until the receiving side scans
//                      the parcel itself. A bag closed with the parcel unscanned marks it LOST
//   AT_HUB             in a hub, ready for a courier run: a last mile hub for delivery, or a
//                      sorting facility's return shelf for the merchant
//   ON_HOLD            at a last mile hub after a failed attempt, waiting for the merchant
//   OUT_FOR_DELIVERY   with a courier on a run (runId), to the consumer or back to the merchant
//   ATTEMPT_FAILED     still with the courier after a failed attempt (runId)
// Direction says where the parcel is heading: FORWARD to the consumer, RETURN to the merchant.

export const SHIPMENT_STATUSES = [
  'CREATED',
  'PICKED_UP',
  'AT_INBOUND',
  'SORTED',
  'AT_OUTBOUND',
  'IN_TRANSIT',
  'AT_HUB',
  'ON_HOLD',
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

/** Parcels physically inside a hub or facility (not on the road, not with a courier). */
export const IN_BUILDING: readonly ShipmentStatus[] = ['AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'AT_HUB', 'ON_HOLD'];

// A status may "move" to itself: the direction or the location changed, the status did not.
export const ALLOWED_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  CREATED: ['PICKED_UP', 'AT_INBOUND', 'CANCELLED'],
  PICKED_UP: ['PICKED_UP', 'AT_INBOUND', 'LOST'],
  AT_INBOUND: ['AT_INBOUND', 'SORTED', 'AT_HUB', 'LOST'],
  SORTED: ['SORTED', 'AT_INBOUND', 'AT_HUB', 'AT_OUTBOUND', 'LOST'],
  AT_OUTBOUND: ['AT_OUTBOUND', 'SORTED', 'AT_INBOUND', 'AT_HUB', 'IN_TRANSIT', 'LOST'],
  IN_TRANSIT: ['IN_TRANSIT', 'AT_INBOUND', 'AT_HUB', 'LOST'],
  AT_HUB: ['AT_HUB', 'AT_OUTBOUND', 'OUT_FOR_DELIVERY', 'ON_HOLD', 'LOST'],
  ON_HOLD: ['AT_HUB', 'ON_HOLD', 'LOST'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED', 'ATTEMPT_FAILED', 'AT_HUB', 'LOST'],
  ATTEMPT_FAILED: ['AT_HUB', 'ON_HOLD', 'LOST'],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
  LOST: ['AT_INBOUND', 'AT_HUB'],
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
  AT_INBOUND: 'At inbound',
  SORTED: 'Sorted, on lane',
  AT_OUTBOUND: 'In outbound bag',
  IN_TRANSIT: 'In transit',
  AT_HUB: 'At hub',
  ON_HOLD: 'On hold',
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

/** Teams inside a sorting facility. Staff with no team (supervisors) can work every station. */
export const TEAMS = ['INBOUND', 'SORTING', 'OUTBOUND'] as const;
export type Team = (typeof TEAMS)[number];
export const TEAM_LABELS: Record<Team, string> = { INBOUND: 'Inbound team', SORTING: 'Sorting team', OUTBOUND: 'Outbound team' };

export const STATUS_LABELS_AR: Record<ShipmentStatus, string> = {
  CREATED: 'تم الإنشاء',
  PICKED_UP: 'تم الاستلام من التاجر',
  AT_INBOUND: 'في الاستلام',
  SORTED: 'تم الفرز على الخط',
  AT_OUTBOUND: 'في شنطة الإرسال',
  IN_TRANSIT: 'في الطريق',
  AT_HUB: 'في المركز',
  ON_HOLD: 'معلق',
  OUT_FOR_DELIVERY: 'خرج للتوصيل',
  ATTEMPT_FAILED: 'محاولة فاشلة',
  DELIVERED: 'تم التوصيل',
  RETURNED: 'تم الإرجاع للتاجر',
  CANCELLED: 'ملغي',
  LOST: 'مفقود',
};

export const FAIL_REASON_LABELS_AR: Record<FailReason, string> = {
  NO_ANSWER: 'العميل لم يرد',
  NOT_AVAILABLE: 'العميل غير متاح',
  POSTPONED: 'العميل طلب يوما آخر',
  CANNOT_PAY: 'العميل لا يستطيع الدفع الآن',
  WRONG_ADDRESS: 'العنوان خطأ أو غير كامل',
  WRONG_PHONE: 'رقم الهاتف خطأ',
  REFUSED: 'العميل رفض الشحنة',
  OTHER: 'أخرى',
};

export const TEAM_LABELS_AR: Record<Team, string> = { INBOUND: 'فريق الاستلام', SORTING: 'فريق الفرز', OUTBOUND: 'فريق الإرسال' };

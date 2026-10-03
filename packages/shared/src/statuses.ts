// Order statuses, grouped exactly as in spec section 4.1.

export const ORDER_STATUSES = [
  'NEW',
  'PENDING_PICKUP',
  'PICKED_UP',
  'AT_SORTING_FACILITY',
  'IN_TRANSFER',
  'AT_LAST_MILE_HUB',
  'ASSIGNED_TO_DRIVER',
  'HEADING_TO_CUSTOMER',
  'RETURNS_ON_WAY',
  'HEADING_TO_MERCHANT',
  'AWAITING_MERCHANT_ACTION',
  'REJECTED_RETURN',
  'DELIVERED',
  'RETURNED',
  'UNSUCCESSFUL',
  'ARCHIVED',
  'TERMINATED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_GROUPS = ['NEW', 'PENDING', 'PROCESSING', 'PAUSED', 'SUCCESSFUL', 'UNSUCCESSFUL'] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const STATUS_GROUP_OF: Record<OrderStatus, StatusGroup> = {
  NEW: 'NEW',
  PENDING_PICKUP: 'PENDING',
  PICKED_UP: 'PROCESSING',
  AT_SORTING_FACILITY: 'PROCESSING',
  IN_TRANSFER: 'PROCESSING',
  AT_LAST_MILE_HUB: 'PROCESSING',
  ASSIGNED_TO_DRIVER: 'PROCESSING',
  HEADING_TO_CUSTOMER: 'PROCESSING',
  RETURNS_ON_WAY: 'PROCESSING',
  HEADING_TO_MERCHANT: 'PROCESSING',
  AWAITING_MERCHANT_ACTION: 'PAUSED',
  REJECTED_RETURN: 'PAUSED',
  DELIVERED: 'SUCCESSFUL',
  RETURNED: 'UNSUCCESSFUL',
  UNSUCCESSFUL: 'UNSUCCESSFUL',
  ARCHIVED: 'UNSUCCESSFUL',
  TERMINATED: 'UNSUCCESSFUL',
};

export function statusesInGroup(group: StatusGroup): OrderStatus[] {
  return ORDER_STATUSES.filter((s) => STATUS_GROUP_OF[s] === group);
}

/**
 * Explicit allowed transitions table (spec 4.1). Anything not listed is rejected.
 * Forward flow:  NEW → PENDING_PICKUP → PICKED_UP → AT_SORTING_FACILITY → IN_TRANSFER
 *                → AT_LAST_MILE_HUB → ASSIGNED_TO_DRIVER → HEADING_TO_CUSTOMER → DELIVERED
 * Return flow:   AT_LAST_MILE_HUB → RETURNS_ON_WAY → AT_SORTING_FACILITY → HEADING_TO_MERCHANT → RETURNED
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ['PENDING_PICKUP', 'TERMINATED', 'ARCHIVED'],
  PENDING_PICKUP: ['PICKED_UP', 'AT_SORTING_FACILITY', 'AWAITING_MERCHANT_ACTION', 'TERMINATED', 'ARCHIVED'],
  PICKED_UP: ['AT_SORTING_FACILITY', 'AT_LAST_MILE_HUB'],
  AT_SORTING_FACILITY: ['IN_TRANSFER', 'AT_LAST_MILE_HUB', 'HEADING_TO_MERCHANT'],
  IN_TRANSFER: ['AT_LAST_MILE_HUB', 'AT_SORTING_FACILITY'],
  AT_LAST_MILE_HUB: ['ASSIGNED_TO_DRIVER', 'RETURNS_ON_WAY', 'AWAITING_MERCHANT_ACTION', 'IN_TRANSFER'],
  ASSIGNED_TO_DRIVER: ['HEADING_TO_CUSTOMER', 'AT_LAST_MILE_HUB'],
  HEADING_TO_CUSTOMER: ['DELIVERED', 'AWAITING_MERCHANT_ACTION', 'REJECTED_RETURN', 'AT_LAST_MILE_HUB'],
  RETURNS_ON_WAY: ['AT_SORTING_FACILITY'],
  HEADING_TO_MERCHANT: ['RETURNED', 'AT_SORTING_FACILITY'],
  AWAITING_MERCHANT_ACTION: ['ASSIGNED_TO_DRIVER', 'AT_LAST_MILE_HUB', 'RETURNS_ON_WAY', 'PENDING_PICKUP', 'UNSUCCESSFUL', 'TERMINATED'],
  REJECTED_RETURN: ['ASSIGNED_TO_DRIVER', 'UNSUCCESSFUL', 'RETURNS_ON_WAY'],
  DELIVERED: ['ARCHIVED'],
  RETURNED: ['ARCHIVED'],
  UNSUCCESSFUL: ['RETURNS_ON_WAY', 'ARCHIVED'],
  ARCHIVED: [],
  TERMINATED: [],
};

/** Transitions a merchant user may trigger themselves. Everything else is operational. */
export const MERCHANT_TRANSITIONS: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  ['NEW', 'PENDING_PICKUP'],
  ['NEW', 'TERMINATED'],
  ['PENDING_PICKUP', 'TERMINATED'],
  ['AWAITING_MERCHANT_ACTION', 'ASSIGNED_TO_DRIVER'],
  ['AWAITING_MERCHANT_ACTION', 'RETURNS_ON_WAY'],
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isMerchantTransition(from: OrderStatus, to: OrderStatus): boolean {
  return MERCHANT_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export const ORDER_TYPES = ['DELIVER', 'EXCHANGE', 'RETURN'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const PACKAGE_SIZES = ['SMALL_MEDIUM', 'LARGE', 'XLARGE', 'XXL_WHITE_BAG', 'LIGHT_BULKY', 'HEAVY_BULKY'] as const;
export type PackageSize = (typeof PACKAGE_SIZES)[number];

export const PACKAGE_SIZE_DIMENSIONS: Record<PackageSize, string> = {
  SMALL_MEDIUM: '35x40',
  LARGE: '45x50',
  XLARGE: '55x60',
  XXL_WHITE_BAG: '100x50',
  LIGHT_BULKY: '>100x50',
  HEAVY_BULKY: 'white goods / furniture',
};

export const FAILED_ATTEMPT_REASONS = [
  'CUSTOMER_REFUSED',
  'WANTS_TO_OPEN_BEFORE_PAYING',
  'POSTPONE_REQUESTED',
  'NOT_ANSWERING_PHONE',
  'NOT_AT_ADDRESS',
  'ADDRESS_INCORRECT',
  'PHONE_INCORRECT',
] as const;
export type FailedAttemptReason = (typeof FAILED_ATTEMPT_REASONS)[number];

export const MERCHANT_TIERS = ['BRONZE', 'SILVER', 'GOLD'] as const;
export type MerchantTier = (typeof MERCHANT_TIERS)[number];

export const PRICING_ZONES = [
  'CAIRO_GIZA',
  'ALEX_BEHIRA',
  'DELTA_CANAL',
  'NEAR_UPPER_EGYPT',
  'FAR_UPPER_MATROUH',
  'NORTH_COAST',
  'SINAI_NEW_VALLEY',
] as const;
export type PricingZone = (typeof PRICING_ZONES)[number];

import { z } from 'zod';

const minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);
const count = z.number().int().min(0).max(100_000);
/** Money in piastres (integer, never a float) */
const piastres = z.number().int().min(0).max(100_000_000);
/** A percentage in basis points: 250 means 2.5% */
const basisPoints = z.number().int().min(0).max(10_000);

/**
 * Every configurable business value, with its default (CLAUDE.md rule 6). Values live in
 * the settings table and are edited from admin; the defaults are only used until then.
 * scope "global" applies everywhere; a dark store id overrides it for that store.
 */
export const SETTING_DEFINITIONS = {
  'sla.accept_minutes': {
    schema: minutes,
    default: 2,
    description: 'Minutes from order arrival until the store accepts it',
    override: 'store',
  },
  'sla.pick_minutes': {
    schema: minutes,
    default: 10,
    description: 'Minutes from acceptance until every item is picked',
    override: 'store',
  },
  'sla.pack_minutes': {
    schema: minutes,
    default: 5,
    description: 'Minutes from picked until packed',
    override: 'store',
  },
  'sla.handover_minutes': {
    schema: minutes,
    default: 5,
    description: 'Minutes from packed until handed to a rider',
    override: 'store',
  },
  'sla.ride_minutes': {
    schema: minutes,
    default: 35,
    description: 'Minutes from hand over until delivered',
    override: 'store',
  },
  'sla.promise_minutes': {
    schema: minutes,
    default: 60,
    description: 'Delivery time promised to the customer',
    override: 'store',
  },
  'stock.buffer_units': {
    schema: count,
    default: 0,
    description: 'Units per SKU and store held back from what Shopify can sell',
    override: 'store',
  },
  'stock.low_stock_threshold': {
    schema: count,
    default: 5,
    description: 'Available units at or below which admin shows a low stock alert',
    override: 'store',
  },
  'delivery.max_orders_per_trip': {
    schema: z.number().int().min(1).max(5),
    default: 2,
    description:
      'Most orders one rider may carry in one trip, when all of them stay inside the SLA',
    override: 'store',
  },
  'delivery.max_attempts': {
    schema: z.number().int().min(1).max(5),
    default: 2,
    description: 'Delivery attempts per order before it finally fails',
    override: 'store',
  },
  'delivery.retry_hold_hours': {
    schema: z.number().int().min(1).max(168),
    default: 48,
    description: 'Hours a failed attempt waits for a retry decision before the order finally fails',
    override: 'store',
  },
  'delivery.return_alert_minutes': {
    schema: minutes,
    default: 120,
    description:
      'Minutes after a failed attempt before admin is alerted that the goods are not back',
    override: 'store',
  },
  'delivery.min_calls_no_answer': {
    schema: z.number().int().min(0).max(5),
    default: 2,
    description:
      'Calls the rider must make from the app before reporting that the customer did not answer',
    override: 'store',
  },
  'tracking.rider_ping_seconds': {
    schema: z.number().int().min(5).max(300),
    default: 20,
    description: 'Seconds between rider position updates while an order is out for delivery',
    override: 'store',
  },
  'tracking.rider_stale_minutes': {
    schema: z.number().int().min(1).max(60),
    default: 5,
    description:
      'Minutes after which the customer map hides a rider position that stopped updating',
    override: 'store',
  },
  'tracking.low_rating_stars': {
    schema: z.number().int().min(0).max(5),
    default: 2,
    description:
      'Customer ratings at or below this many stars raise an admin alert (0 turns it off)',
    override: 'none',
  },
  'fee.order_fixed_piastres': {
    schema: piastres,
    default: 0,
    description: 'Fixed fee per delivered order, in piastres',
    override: 'merchant',
  },
  'fee.order_percent_bp': {
    schema: basisPoints,
    default: 0,
    description: 'Fee per delivered order as a share of the products value, in basis points',
    override: 'merchant',
  },
  'fee.cod_percent_bp': {
    schema: basisPoints,
    default: 0,
    description: 'COD handling fee as a share of the cash collected, in basis points',
    override: 'merchant',
  },
  'fee.failed_delivery_piastres': {
    schema: piastres,
    default: 0,
    description: 'Fee when a delivery fails and the goods come back, in piastres',
    override: 'merchant',
  },
  'fee.receiving_per_unit_piastres': {
    schema: piastres,
    default: 0,
    description: 'Fee per unit received from a merchant shipment, in piastres',
    override: 'merchant',
  },
  'fee.storage_per_unit_month_piastres': {
    schema: piastres,
    default: 0,
    description: 'Storage fee per unit per month, charged daily on units in stock, in piastres',
    override: 'merchant',
  },
  'fee.return_per_unit_piastres': {
    schema: piastres,
    default: 0,
    description: 'Fee per unit returned to the merchant from a dark store, in piastres',
    override: 'merchant',
  },
  'fee.vat_bp': {
    schema: basisPoints,
    default: 0,
    description: 'VAT added to our fees, in basis points (1400 is 14%)',
    override: 'none',
  },
  'rider.bonus_per_delivery_piastres': {
    schema: piastres,
    default: 0,
    description: 'Bonus a rider earns per delivered order, in piastres',
    override: 'store',
  },
  'store.capacity_orders_per_hour': {
    schema: count,
    default: 20,
    description: 'Orders a store accepts per hour before it stops offering 60 minute delivery',
    override: 'store',
  },
} as const satisfies Record<
  string,
  {
    schema: z.ZodType<number>;
    default: number;
    description: string;
    /** Which per scope value is allowed besides the global one */
    override: 'store' | 'merchant' | 'none';
  }
>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export const GLOBAL_SCOPE = 'global';

/** Settings scope for one merchant's own value, for example a negotiated fee. */
export function merchantScope(merchantId: string) {
  return `merchant:${merchantId}`;
}

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTING_DEFINITIONS;
}

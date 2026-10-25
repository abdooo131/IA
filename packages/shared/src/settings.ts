import { z } from 'zod';

const minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);
const count = z.number().int().min(0).max(100_000);

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
  },
  'sla.pick_minutes': {
    schema: minutes,
    default: 10,
    description: 'Minutes from acceptance until every item is picked',
  },
  'sla.pack_minutes': {
    schema: minutes,
    default: 5,
    description: 'Minutes from picked until packed',
  },
  'sla.handover_minutes': {
    schema: minutes,
    default: 5,
    description: 'Minutes from packed until handed to a rider',
  },
  'sla.ride_minutes': {
    schema: minutes,
    default: 35,
    description: 'Minutes from hand over until delivered',
  },
  'sla.promise_minutes': {
    schema: minutes,
    default: 60,
    description: 'Delivery time promised to the customer',
  },
  'stock.buffer_units': {
    schema: count,
    default: 0,
    description: 'Units per SKU and store held back from what Shopify can sell',
  },
  'stock.low_stock_threshold': {
    schema: count,
    default: 5,
    description: 'Available units at or below which admin shows a low stock alert',
  },
  'delivery.max_orders_per_trip': {
    schema: z.number().int().min(1).max(5),
    default: 2,
    description:
      'Most orders one rider may carry in one trip, when all of them stay inside the SLA',
  },
  'store.capacity_orders_per_hour': {
    schema: count,
    default: 20,
    description: 'Orders a store accepts per hour before it stops offering 60 minute delivery',
  },
} as const satisfies Record<
  string,
  { schema: z.ZodType<number>; default: number; description: string }
>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export const GLOBAL_SCOPE = 'global';

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTING_DEFINITIONS;
}

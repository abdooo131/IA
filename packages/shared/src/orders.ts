import { z } from 'zod';

export const ORDER_STATUSES = [
  'new',
  'accepted',
  'picking',
  'packed',
  'out_for_delivery',
  'attempt_failed',
  'delivered',
  'cancelled',
  'failed',
  'moved_to_standard',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTIVE_STATUSES: OrderStatus[] = [
  'new',
  'accepted',
  'picking',
  'packed',
  'out_for_delivery',
];
/** Not moving and not closed: a failed attempt waiting for its goods and a decision. */
export const WAITING_STATUSES: OrderStatus[] = ['attempt_failed'];
export const CLOSED_STATUSES: OrderStatus[] = [
  'delivered',
  'cancelled',
  'failed',
  'moved_to_standard',
];

/** The stage an active order is in, and which SLA setting times it. */
export const SLA_STAGES = {
  new: { stage: 'accept', setting: 'sla.accept_minutes', startsAt: 'placedAt' },
  accepted: { stage: 'pick', setting: 'sla.pick_minutes', startsAt: 'acceptedAt' },
  picking: { stage: 'pick', setting: 'sla.pick_minutes', startsAt: 'acceptedAt' },
  packed: { stage: 'handover', setting: 'sla.handover_minutes', startsAt: 'packedAt' },
  out_for_delivery: { stage: 'ride', setting: 'sla.ride_minutes', startsAt: 'outForDeliveryAt' },
} as const;

export type SlaStage = 'accept' | 'pick' | 'pack' | 'handover' | 'ride';

export interface StageTimes {
  status: OrderStatus;
  placedAt: Date;
  /** Set when an order waits for the store to open: the clock starts then, not at placement */
  slaStartsAt?: Date | null;
  acceptedAt: Date | null;
  pickedAt: Date | null;
  packedAt: Date | null;
  outForDeliveryAt: Date | null;
}

export interface SlaMinutes {
  accept: number;
  pick: number;
  pack: number;
  handover: number;
  ride: number;
}

/**
 * When the current stage of an order is due. Picking ends when every item is picked
 * (picked_at); from then the pack timer runs until the order is packed.
 */
export function currentStageDue(
  order: StageTimes,
  sla: SlaMinutes,
): { stage: SlaStage; dueAt: Date } | null {
  const plus = (from: Date | null, minutes: number) =>
    from ? new Date(from.getTime() + minutes * 60_000) : null;
  let result: { stage: SlaStage; dueAt: Date | null };
  switch (order.status) {
    case 'new':
      result = { stage: 'accept', dueAt: plus(order.slaStartsAt ?? order.placedAt, sla.accept) };
      break;
    case 'accepted':
    case 'picking':
      result = order.pickedAt
        ? { stage: 'pack', dueAt: plus(order.pickedAt, sla.pack) }
        : { stage: 'pick', dueAt: plus(order.acceptedAt, sla.pick) };
      break;
    case 'packed':
      result = { stage: 'handover', dueAt: plus(order.packedAt, sla.handover) };
      break;
    case 'out_for_delivery':
      result = { stage: 'ride', dueAt: plus(order.outForDeliveryAt, sla.ride) };
      break;
    default:
      return null;
  }
  return result.dueAt ? { stage: result.stage, dueAt: result.dueAt } : null;
}

const id = z.string().min(1).max(64);

export const orderItemInputSchema = z.object({
  skuId: id,
  quantity: z.number().int().min(1).max(1000),
  /** Optional: defaults to the catalog price */
  unitPricePiastres: z.number().int().min(0).max(100_000_000).optional(),
});

export const createOrderSchema = z
  .object({
    customerName: z.string().trim().min(2).max(120),
    customerPhone: z.string().trim().min(5).max(30),
    addressText: z.string().trim().min(5).max(500),
    customerNote: z.string().trim().max(500).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    paymentMethod: z.enum(['prepaid', 'cod']),
    deliveryFeePiastres: z.number().int().min(0).max(10_000_000).default(0),
    items: z.array(orderItemInputSchema).min(1).max(100),
    /** Admin only: which merchant the order belongs to */
    merchantId: id.optional(),
  })
  .refine((o) => new Set(o.items.map((i) => i.skuId)).size === o.items.length, {
    message: 'duplicate_sku',
    path: ['items'],
  });
export type CreateOrderBody = z.infer<typeof createOrderSchema>;

export const pickScanSchema = z.object({
  skuId: id,
  /** The bin scanned, or empty to take from the suggested bin */
  binId: id.optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
  idempotencyKey: z.string().min(8).max(100),
});

export const missingItemSchema = z.object({
  skuId: id,
  quantity: z.number().int().min(1).max(1000),
  idempotencyKey: z.string().min(8).max(100),
});

export const handoverSchema = z.object({ badgeCode: z.string().trim().min(2).max(40) });

export const cancelOrderSchema = z.object({ reason: z.string().trim().min(2).max(300) });

export const FAILURE_REASONS = [
  'no_answer',
  'wrong_address',
  'refused',
  'reschedule_requested',
  'unreachable_area',
  'other',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];
/** A customer who refused the goods gets no second attempt. */
export const FINAL_FAILURE_REASONS: FailureReason[] = ['refused'];
export const failDeliverySchema = z
  .object({
    reason: z.enum(FAILURE_REASONS),
    note: z.string().trim().max(300).optional(),
    /** Photo at the door; required when the customer did not answer */
    photoId: id.optional(),
  })
  .refine((b) => b.reason !== 'other' || (b.note && b.note.length >= 3), {
    message: 'note_required',
    path: ['note'],
  });

/** What happens to an order after a failed attempt. */
export const failedOrderDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry') }),
  z.object({
    action: z.enum(['ship_normally', 'cancel']),
    reason: z.string().trim().max(300).optional(),
  }),
]);
export type FailedOrderDecision = z.infer<typeof failedOrderDecisionSchema>;

export const completeDeliverySchema = z
  .object({
    otp: z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .optional(),
    photoId: id.optional(),
    codCollectedPiastres: z.number().int().min(0).max(100_000_000).optional(),
  })
  .refine((b) => b.otp || b.photoId, { message: 'proof_required' });

/** A 4 digit code the customer gives the rider. */
export function newDeliveryOtp(random: () => number = Math.random): string {
  return String(Math.floor(random() * 10_000)).padStart(4, '0');
}

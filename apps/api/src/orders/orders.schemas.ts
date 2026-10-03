import { ORDER_STATUSES, ORDER_TYPES, PACKAGE_SIZES, STATUS_GROUPS } from '@shiply/shared';
import { z } from 'zod';

export const CreateOrderSchema = z.object({
  merchantId: z.string().uuid().optional(),
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().trim().min(8).max(20),
  customerPhoneAlt: z.string().trim().max(20).optional().nullable(),
  governorateCode: z.string().trim().min(2).max(5),
  area: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(5).max(400),
  codAmount: z.number().int().min(0),
  size: z.enum(PACKAGE_SIZES).optional(),
  type: z.enum(ORDER_TYPES).default('DELIVER'),
  allowOpenPackage: z.boolean().optional(),
  itemsDescription: z.string().trim().max(500).optional().nullable(),
  returnItemsDescription: z.string().trim().max(500).optional().nullable(),
  merchantReference: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  pickupLocationId: z.string().uuid().optional().nullable(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const ListOrdersSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  group: z.enum(STATUS_GROUPS).optional(),
  q: z.string().trim().max(100).optional(),
  printed: z.enum(['true', 'false']).optional(),
  governorateCode: z.string().optional(),
  type: z.enum(ORDER_TYPES).optional(),
  merchantId: z.string().uuid().optional(),
  needsManualHub: z.enum(['true', 'false']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type ListOrdersQuery = z.infer<typeof ListOrdersSchema>;

export const TransitionSchema = z.object({
  to: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export const IdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

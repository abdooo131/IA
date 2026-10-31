export type OrderStatus =
  | 'new'
  | 'accepted'
  | 'picking'
  | 'packed'
  | 'out_for_delivery'
  | 'attempt_failed'
  | 'delivered'
  | 'cancelled'
  | 'failed'
  | 'moved_to_standard';

export type SlaStage = 'accept' | 'pick' | 'pack' | 'handover' | 'ride';

interface Named {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface OrderItemView {
  skuId: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  quantity: number;
  pickedQty: number;
  cancelledQty: number;
  unitPricePiastres: number;
  bins?: { id: string; code: string; quantity: number }[];
}

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  source: 'manual' | 'shopify';
  merchant: { id: string; name: string };
  darkStore: Named;
  customerName: string;
  customerPhone: string;
  phoneFlagged: boolean;
  addressText: string;
  paymentMethod: 'cod' | 'prepaid';
  subtotalPiastres: number;
  deliveryFeePiastres: number;
  codAmountPiastres: number;
  placedAt: string;
  slaDueAt: string | null;
  /** Set when the order waits for the store to open */
  slaStartsAt: string | null;
  deliveredAt: string | null;
  closedReason: string | null;
  /** While attempt_failed: when the order fails for good if nobody decides */
  retryHoldUntil: string | null;
  /** While attempt_failed: the goods of the last attempt are back in the store */
  goodsBack: boolean;
  lateStage: SlaStage | null;
  stage: { stage: SlaStage; dueAt: string; late: boolean } | null;
  units: number;
  items: OrderItemView[];
  rider: { name: string; badge: string; status: string } | null;
}

export interface OrderDetail extends OrderSummary {
  deliveryOtp?: string;
  trackingToken?: string;
  customerNote: string | null;
  latitude: number | null;
  longitude: number | null;
  zone: { code: string; nameEn: string; nameAr: string } | null;
  createdBy: string | null;
  acceptedAt: string | null;
  pickedAt: string | null;
  packedAt: string | null;
  outForDeliveryAt: string | null;
  closedAt: string | null;
  packPhotoId: string | null;
  deliveries: {
    id: string;
    status: string;
    rider: string;
    badge: string;
    tripId: string | null;
    pickedUpAt: string | null;
    deliveredAt: string | null;
    failedAt: string | null;
    failedReason: string | null;
    callAttempts: number;
    failedPhotoId: string | null;
    returnedAt: string | null;
    otpVerified: boolean;
    proofPhotoId: string | null;
    codExpectedPiastres: number;
    codCollectedPiastres: number | null;
  }[];
  events: { at: string; type: string; by: string | null; data: Record<string, unknown> | null }[];
  alerts: {
    id: string;
    type: string;
    stage: string | null;
    data: unknown;
    createdAt: string;
    resolvedAt: string | null;
  }[];
}

export const ORDER_STATUS_LIST: OrderStatus[] = [
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
];

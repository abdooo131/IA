import type { OrderStatus } from './order-types';

/** GET /track/:token, the customer's public view of one order. */
export interface TrackingView {
  number: string;
  merchantName: string;
  storeNameEn: string;
  storeNameAr: string;
  status: OrderStatus;
  placedAt: string;
  promiseAt: string | null;
  acceptedAt: string | null;
  packedAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  paymentMethod: 'prepaid' | 'cod';
  codAmountPiastres: number;
  deliveryCode: string | null;
  riderName: string | null;
  riderPosition: { lat: number; lng: number; at: string } | null;
  destination: { lat: number; lng: number } | null;
  refreshSeconds: number;
  hasProofPhoto: boolean;
  rating: { stars: number; comment: string | null } | null;
  canRate: boolean;
}

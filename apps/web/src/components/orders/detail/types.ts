import type { Risk } from '@/lib/customer-types';
import type { OrderDetail, OrderMoney, OrderNote } from '@/lib/order-types';

/** Who is looking at the order page; the API already left out what the viewer may not see. */
export type OrderViewer = 'admin' | 'merchant';

export interface OrderScreenProps {
  order: OrderDetail;
  viewer: OrderViewer;
  tab: 'details' | 'tracking';
  /** /admin/orders or /merchant/orders: the list, and the base of summary and label pages */
  basePath: string;
  /** The API path of the order (/admin/orders/<id>), for cancel, decision and notes */
  apiPath: string;
  cancellable: boolean;
  created?: boolean;
  /** Notes the viewer may read; null when the notes could not be read */
  notes: OrderNote[] | null;
  /** The viewer may read and write the team's internal thread */
  teamNotes: boolean;
  /** Fees and payout from the ledger; null when the viewer may not see money */
  money: OrderMoney | null;
  /** Admin only: the customer behind the order and their cash on delivery risk */
  customer: { id: string; risk: Risk } | null;
  /** Opens a ticket about the order (team members) */
  ticketHref?: string;
}

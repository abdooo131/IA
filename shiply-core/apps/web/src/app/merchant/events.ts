// Friendly words for parcel history events, shown to merchants.
export const EVENT_TEXT: Record<string, string> = {
  CREATED: 'Parcel created',
  CANCELLED: 'Cancelled',
  PICKED_UP: 'Picked up by our courier',
  DROPPED_OFF: 'Dropped off at our sorting facility',
  RECEIVED_FROM_PICKUP: 'Received at our sorting facility',
  SORTED: 'Sorted into a bag',
  HANDED_TO_OUTBOUND: 'Ready to leave the sorting facility',
  RETURN_SHELF: 'Ready to hand back to you',
  UNBAGGED: 'Taken out of a bag',
  DEPARTED: 'Left on a line haul trip',
  RECEIVED_FROM_TRANSFER: 'Arrived at a hub',
  UNEXPECTED_ARRIVAL: 'Arrived at a hub',
  LOADED_ON_RUN: 'Loaded for delivery',
  REMOVED_FROM_RUN: 'Taken off a delivery run',
  OUT_FOR_DELIVERY: 'Out for delivery',
  OUT_FOR_RETURN: 'Out for return to you',
  DELIVERED: 'Delivered',
  ATTEMPT_FAILED: 'Delivery attempt failed',
  RETURN_ATTEMPT_FAILED: 'Return attempt failed',
  NOT_ATTEMPTED: 'Back at hub, not attempted',
  BACK_FROM_COURIER: 'Back at hub from courier',
  ON_HOLD: 'On hold, waiting for your decision',
  REATTEMPT_REQUESTED: 'You asked to try again',
  RETURN_REQUESTED: 'Return requested',
  RETURN_STARTED: 'Coming back to you',
  RETURNED: 'Returned to you',
  MARKED_LOST: 'Marked lost',
  FOUND: 'Found',
};

export function eventText(type: string): string {
  return EVENT_TEXT[type] ?? type.toLowerCase().replace(/_/g, ' ');
}

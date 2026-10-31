/**
 * The path each kind of document walks, in order, and the side states that end it early.
 * The status bar shows the path with the current step lit; a side state shows apart, in red.
 */
export const WORKFLOWS = {
  order: {
    path: ['new', 'accepted', 'picking', 'packed', 'out_for_delivery', 'delivered'],
    side: ['attempt_failed', 'cancelled', 'failed', 'moved_to_standard'],
  },
  shipment: { path: ['expected', 'receiving', 'received'], side: ['cancelled'] },
  transfer: {
    path: ['draft', 'approved', 'picking', 'in_transit', 'received'],
    side: ['cancelled'],
  },
  return: { path: ['requested', 'picking', 'ready', 'collected'], side: ['cancelled'] },
  payout: { path: ['draft', 'paid'], side: ['cancelled'] },
  handover: { path: ['pending', 'balanced'], side: ['written_off', 'charged_to_rider'] },
  signup: { path: ['pending', 'approved'], side: ['rejected'] },
  ticket: { path: ['open', 'answered', 'closed'], side: [] },
} as const;

export type WorkflowName = keyof typeof WORKFLOWS;

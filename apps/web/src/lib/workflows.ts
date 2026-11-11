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
  cheque_received: {
    path: ['awaiting_approval', 'received', 'deposited', 'cleared'],
    side: ['bounced', 'cancelled'],
  },
  cheque_issued: {
    path: ['awaiting_approval', 'issued', 'cleared'],
    side: ['bounced', 'cancelled'],
  },
  deal: {
    path: ['new', 'contacted', 'meeting', 'proposal', 'negotiation', 'won'],
    side: ['lost'],
  },
  // HR phase 3: leave asks the manager, then HR; a violation may be appealed once; a fix to an
  // attendance day goes from the manager to HR, who applies it.
  leave: { path: ['pending_manager', 'pending_hr', 'approved'], side: ['rejected', 'cancelled'] },
  violation: { path: ['recorded', 'appealed', 'final'], side: ['cancelled'] },
  correction: {
    path: ['pending_manager', 'pending_hr', 'applied'],
    side: ['rejected', 'cancelled'],
  },
  // Accounting UX phase A: the documents with a document page.
  bill: { path: ['open', 'paid'], side: ['cancelled'] },
  rider_withdrawal: { path: ['requested', 'approved', 'paid'], side: ['rejected', 'cancelled'] },
  // An employee's expense claim: their manager approves, Accounting pays it back.
  expense_claim: {
    path: ['pending_manager', 'pending_accounting', 'paid'],
    side: ['rejected', 'cancelled'],
  },
  // A rider's Basata cash deposit: Accounting checks the receipt and approves or rejects it.
  basata_deposit: { path: ['pending', 'approved'], side: ['rejected'] },
  finance_request: { path: ['pending', 'approved'], side: ['rejected', 'cancelled'] },
  petty_cash: { path: ['pending', 'posted'], side: ['rejected', 'cancelled', 'reversed'] },
  eta: { path: ['not_sent', 'signed', 'submitted', 'valid'], side: ['invalid', 'rejected'] },
  purchase_order: {
    path: ['requested', 'approved', 'ordered', 'received', 'billed', 'closed'],
    side: ['rejected', 'cancelled'],
  },
  // UX phase C step 1: a damage report waits for admin to settle who pays.
  damage: { path: ['pending', 'settled'], side: [] },
  // UX phase C step 2: a stock count waits for admin; a bin that changed makes it stale.
  count: { path: ['submitted', 'approved'], side: ['rejected', 'stale'] },
  // UX phase C step 3: a merchant signs up, is approved and works; a pause or a refusal stops it.
  merchant: { path: ['pending', 'active'], side: ['paused', 'rejected'] },
  // UX phase C step 4: a person joins on probation, works, may leave (a last day ahead) and
  // leaves; suspended or on leave show apart.
  employee: {
    path: ['on_probation', 'active', 'leaving', 'left'],
    side: ['suspended', 'on_leave'],
  },
} as const;

export type WorkflowName = keyof typeof WORKFLOWS;

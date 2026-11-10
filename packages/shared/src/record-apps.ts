import type { AccessApp } from './access';

/**
 * Which app's people may read a record's history, notes and activities (view level; writing
 * a note or scheduling an activity needs use). Money records belong to accounting; merchants
 * and riders have wallets, so accounting reads theirs too. Anything not listed (users,
 * settings, tickets...) is for settings manage.
 */
export const RECORD_APPS: Record<string, readonly AccessApp[]> = {
  order: ['operations'],
  alert: ['operations'],
  zone: ['operations'],
  dark_store: ['operations'],
  geo_area: ['operations'],
  transfer: ['inventory'],
  inbound_manifest: ['inventory'],
  merchant_return: ['inventory'],
  damage_report: ['inventory'],
  stock_count: ['inventory'],
  stock_level: ['inventory'],
  stock_target: ['inventory'],
  refill: ['inventory'],
  merchant: ['merchants', 'accounting'],
  sku: ['merchants'],
  shopify_shop: ['merchants'],
  shopify_app: ['merchants'],
  rider: ['operations', 'accounting'],
  customer: ['customers'],
  payout: ['accounting'],
  cash_handover: ['accounting'],
  ledger_account: ['accounting'],
  ledger_entry: ['accounting'],
  finance_request: ['accounting'],
  tax_invoice: ['accounting'],
  bill: ['accounting'],
  purchase_order: ['accounting'],
  packaging_item: ['inventory', 'accounting'],
  email: ['accounting'],
  supplier: ['accounting'],
  bank_statement: ['accounting'],
  bank_statement_line: ['accounting'],
  recurring_entry: ['accounting'],
  fixed_asset: ['accounting'],
  prepayment: ['accounting'],
  budget: ['accounting'],
  company_profile: ['accounting'],
  books: ['accounting'],
  employee: ['hr'],
  leave_request: ['hr'],
  leave_type: ['hr'],
  violation: ['hr'],
  violation_type: ['hr'],
  attendance_correction: ['hr'],
  cheque: ['accounting'],
  merchant_contract: ['merchants', 'accounting'],
  rider_withdrawal: ['accounting'],
  petty_cash: ['accounting'],
  expense_claim: ['accounting'],
  // UX phase C step 4: Sales records (a rep with own_deals_only reaches only their own).
  crm_deal: ['sales'],
  crm_company: ['sales'],
};

/**
 * Records about a named person (a customer profile): their history, notes and activities also
 * need the customer data switch, whatever the app level (settings manage included).
 */
export const RECORD_NEEDS_CUSTOMER_DATA: readonly string[] = ['customer'];

/** Whether a person may read or write a record type's chatter and history at a level. */
export function recordNeedsCustomerData(entityType: string) {
  return RECORD_NEEDS_CUSTOMER_DATA.includes(entityType);
}

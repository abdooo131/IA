// The tabs of one merchant's page (/admin/merchants/<id>?tab=), kept in the address.

export const MERCHANT_TABS = [
  'overview',
  'contract',
  'shopify',
  'products',
  'users',
  'profit',
  'history',
] as const;
export type MerchantTab = (typeof MERCHANT_TABS)[number];

/** The tabs a person sees: Profit only with Accounting. */
export function merchantTabs(opts: { canProfit: boolean }): MerchantTab[] {
  return MERCHANT_TABS.filter((t) => t !== 'profit' || opts.canProfit);
}

/** The tab asked for when the person may open it, else the overview. */
export function pickMerchantTab(asked: string | undefined, tabs: readonly MerchantTab[]) {
  return tabs.includes(asked as MerchantTab) ? (asked as MerchantTab) : 'overview';
}

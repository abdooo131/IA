/** A bank account's balance in its own currency, for example "1,250.00 USD" (Latin digits). */
export function formatForeign(cents: number, currency: string) {
  const value = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value} ${currency}`;
}

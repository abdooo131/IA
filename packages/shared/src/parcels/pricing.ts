import { applyBp } from './money';
import type { ParcelSize } from './statuses';

export interface ZonePrices {
  priceS: number;
  priceM: number;
  priceL: number;
  priceXL: number;
  priceXXL: number;
  priceBulky: number;
}

export const SIZE_LABELS: Record<ParcelSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
  XXL: 'Double extra large',
  BULKY: 'Bulky',
};

/** The zone's list price for a size. */
export function listPrice(zone: ZonePrices, size: ParcelSize): number {
  return {
    S: zone.priceS,
    M: zone.priceM,
    L: zone.priceL,
    XL: zone.priceXL,
    XXL: zone.priceXXL,
    BULKY: zone.priceBulky,
  }[size];
}

export interface PriceQuote {
  basePrice: number;
  discount: number;
  openFee: number;
  exchangeFee: number;
  /** What the merchant pays for shipping (VAT included): base minus discount plus extras. */
  shippingFee: number;
}

/**
 * The shipping price of one parcel. A price agreed with the merchant replaces the list price and
 * takes no discount; otherwise the merchant's own discount, or their volume tier's, applies.
 * Extras: a fee when the customer may open the parcel, and a share of the price for an exchange.
 */
export function quote(a: {
  zone: ZonePrices;
  size: ParcelSize;
  agreedPrice?: number | null;
  discountBp: number;
  allowOpen: boolean;
  openFee: number;
  exchange: boolean;
  exchangeBp: number;
}): PriceQuote {
  const basePrice = a.agreedPrice ?? listPrice(a.zone, a.size);
  const discount = a.agreedPrice != null ? 0 : applyBp(basePrice, a.discountBp);
  const net = basePrice - discount;
  const openFee = a.allowOpen ? a.openFee : 0;
  const exchangeFee = a.exchange ? applyBp(net, a.exchangeBp) : 0;
  return { basePrice, discount, openFee, exchangeFee, shippingFee: net + openFee + exchangeFee };
}

export interface FeeSettings {
  codFeeBp: number;
  codFreeAmount: number;
  returnFeeBp: number;
}

export function shippingFee(
  zone: ZonePrices,
  size: ParcelSize,
  merchantDiscountBp: number,
): number {
  const base = listPrice(zone, size);
  return base - applyBp(base, merchantDiscountBp);
}

/** Fee on the cash we collect, charged only on the part above the free amount. */
export function codFee(codAmount: number, settings: FeeSettings): number {
  if (codAmount <= settings.codFreeAmount) return 0;
  return applyBp(codAmount - settings.codFreeAmount, settings.codFeeBp);
}

/** Charged when a parcel comes back to the merchant, on top of the shipping fee. */
export function returnFee(shipping: number, settings: FeeSettings): number {
  return applyBp(shipping, settings.returnFeeBp);
}

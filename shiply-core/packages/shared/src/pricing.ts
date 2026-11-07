import { applyBp } from './money';
import type { ParcelSize } from './statuses';

export interface ZonePrices {
  priceS: number;
  priceM: number;
  priceL: number;
  priceXL: number;
}

export interface FeeSettings {
  codFeeBp: number;
  codFreeAmount: number;
  returnFeeBp: number;
}

export function shippingFee(zone: ZonePrices, size: ParcelSize, merchantDiscountBp: number): number {
  const base = { S: zone.priceS, M: zone.priceM, L: zone.priceL, XL: zone.priceXL }[size];
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

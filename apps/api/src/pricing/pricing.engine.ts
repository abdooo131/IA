import type { MerchantTier, OrderType, PackageSize, PricingZone } from '@shiply/shared';

/** Pure pricing calculation. All amounts are integer piastres, all rates basis points. */

export interface PricingInput {
  pickupZone: PricingZone;
  destZone: PricingZone;
  size: PackageSize;
  orderType: OrderType;
  tier: MerchantTier;
  codAmount: number;
  allowOpenPackage: boolean;
  vatEnabled: boolean;
}

export interface PricingTables {
  zoneBasePrice: number; // pricing_zone_prices row for (pickupZone, destZone)
  sizeAdd: number; // pricing_size_adjustments for size
  tierMultiplierBp: number; // pricing_tier_adjustments for tier
  overridePrice: number | null; // pricing_overrides exact cell, if any
}

export interface PricingConfig {
  exchangeMultiplierBp: number;
  returnMultiplierBp: number;
  failedDeliveryRateBp: number;
  vatRateBp: number;
  codFeeThreshold: number;
  codFeeRateBp: number;
  codFeeMode: 'excess' | 'full';
  openPackageFee: number;
  vatAppliesToFees: boolean;
}

export interface PricingResult {
  shippingFee: number;
  codFee: number;
  openPackageFee: number;
  vatAmount: number;
  totalFees: number;
  failedDeliveryFee: number;
  snapshot: Record<string, unknown>;
}

/** Integer a*bp/10000 rounded half up. Inputs must be non negative integers. */
export function applyBp(amount: number, bp: number): number {
  assertInt(amount, 'amount');
  assertInt(bp, 'bp');
  return Math.floor((amount * bp * 2 + 10000) / 20000);
}

function assertInt(v: number, name: string) {
  if (!Number.isInteger(v) || v < 0) throw new Error(`${name} must be a non negative integer, got ${v}`);
}

export function calculatePrice(input: PricingInput, tables: PricingTables, cfg: PricingConfig): PricingResult {
  assertInt(input.codAmount, 'codAmount');

  let shippingFee: number;
  let typeMultiplierBp = 10000;
  if (tables.overridePrice !== null) {
    shippingFee = tables.overridePrice;
  } else {
    const base = tables.zoneBasePrice + tables.sizeAdd;
    if (input.orderType === 'EXCHANGE') typeMultiplierBp = cfg.exchangeMultiplierBp;
    if (input.orderType === 'RETURN') typeMultiplierBp = cfg.returnMultiplierBp;
    shippingFee = applyBp(applyBp(base, typeMultiplierBp), tables.tierMultiplierBp);
  }

  let codFee = 0;
  if (input.codAmount > cfg.codFeeThreshold) {
    const feeBase = cfg.codFeeMode === 'full' ? input.codAmount : input.codAmount - cfg.codFeeThreshold;
    codFee = applyBp(feeBase, cfg.codFeeRateBp);
  }

  const openPackageFee = input.allowOpenPackage ? cfg.openPackageFee : 0;
  const taxable = shippingFee + (cfg.vatAppliesToFees ? codFee + openPackageFee : 0);
  const vatAmount = input.vatEnabled ? applyBp(taxable, cfg.vatRateBp) : 0;
  const totalFees = shippingFee + codFee + openPackageFee + vatAmount;
  const failedDeliveryFee = applyBp(shippingFee, cfg.failedDeliveryRateBp);

  return {
    shippingFee,
    codFee,
    openPackageFee,
    vatAmount,
    totalFees,
    failedDeliveryFee,
    snapshot: {
      input,
      tables,
      config: cfg,
      typeMultiplierBp,
      calculatedAt: new Date().toISOString(),
      note: 'failedDeliveryFee excludes VAT; VAT is applied when the charge is posted',
    },
  };
}

import { Injectable } from '@nestjs/common';
import type { MerchantTier, OrderType, PackageSize, PricingZone } from '@shiply/shared';
import { ConfigService } from '../config/config.service';
import { Tx } from '../prisma/prisma.service';
import { calculatePrice, PricingConfig, PricingInput, PricingResult } from './pricing.engine';

const CONFIG_KEYS = {
  exchangeMultiplierBp: 'pricing.exchange_multiplier_bp',
  returnMultiplierBp: 'pricing.return_multiplier_bp',
  failedDeliveryRateBp: 'pricing.failed_delivery_rate_bp',
  vatRateBp: 'pricing.vat_rate_bp',
  codFeeThreshold: 'pricing.cod_fee_threshold',
  codFeeRateBp: 'pricing.cod_fee_rate_bp',
  codFeeMode: 'pricing.cod_fee_mode',
  openPackageFee: 'pricing.open_package_fee',
  vatAppliesToFees: 'pricing.vat_applies_to_fees',
} as const;

export class PricingError extends Error {}

@Injectable()
export class PricingService {
  constructor(private readonly config: ConfigService) {}

  async loadConfig(tx: Tx): Promise<PricingConfig> {
    const raw = await this.config.getMany(Object.values(CONFIG_KEYS), tx);
    const cfg = {} as Record<string, unknown>;
    for (const [field, key] of Object.entries(CONFIG_KEYS)) cfg[field] = raw[key];
    return cfg as unknown as PricingConfig;
  }

  async quote(tx: Tx, input: PricingInput, cfg?: PricingConfig): Promise<PricingResult> {
    const [zone, size, tier, override] = await Promise.all([
      tx.pricingZonePrice.findUnique({
        where: { pickupZone_destZone: { pickupZone: input.pickupZone, destZone: input.destZone } },
      }),
      tx.pricingSizeAdjustment.findUnique({ where: { size: input.size } }),
      tx.pricingTierAdjustment.findUnique({ where: { tier: input.tier } }),
      tx.pricingOverride.findUnique({
        where: {
          pickupZone_destZone_size_orderType_tier: {
            pickupZone: input.pickupZone,
            destZone: input.destZone,
            size: input.size,
            orderType: input.orderType,
            tier: input.tier,
          },
        },
      }),
    ]);
    if (!override && !zone) throw new PricingError(`No price configured from ${input.pickupZone} to ${input.destZone}`);
    return calculatePrice(
      input,
      {
        zoneBasePrice: zone?.basePricePiastres ?? 0,
        sizeAdd: size?.addPiastres ?? 0,
        tierMultiplierBp: tier?.multiplierBp ?? 10000,
        overridePrice: override?.pricePiastres ?? null,
      },
      cfg ?? (await this.loadConfig(tx)),
    );
  }
}

export type { PricingInput, MerchantTier, OrderType, PackageSize, PricingZone };

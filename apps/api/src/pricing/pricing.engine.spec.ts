import { applyBp, calculatePrice, PricingConfig, PricingInput, PricingTables } from './pricing.engine';

const cfg: PricingConfig = {
  exchangeMultiplierBp: 12500,
  returnMultiplierBp: 10000,
  failedDeliveryRateBp: 6000,
  vatRateBp: 1400,
  codFeeThreshold: 300000,
  codFeeRateBp: 100,
  codFeeMode: 'excess',
  openPackageFee: 700,
  vatAppliesToFees: true,
};
const tables: PricingTables = { zoneBasePrice: 8000, sizeAdd: 0, tierMultiplierBp: 10000, overridePrice: null };
const input: PricingInput = {
  pickupZone: 'CAIRO_GIZA',
  destZone: 'CAIRO_GIZA',
  size: 'SMALL_MEDIUM',
  orderType: 'DELIVER',
  tier: 'BRONZE',
  codAmount: 50000,
  allowOpenPackage: false,
  vatEnabled: false,
};

describe('pricing engine (spec section 5 defaults)', () => {
  it('base Cairo & Giza Small/Medium is 80 EGP excl. VAT', () => {
    const r = calculatePrice(input, tables, cfg);
    expect(r.shippingFee).toBe(8000);
    expect(r.totalFees).toBe(8000);
  });

  it('failed delivery is 60% of shipping: 48 EGP on 80', () => {
    expect(calculatePrice(input, tables, cfg).failedDeliveryFee).toBe(4800);
  });

  it('exchange is 1.25x deliver', () => {
    expect(calculatePrice({ ...input, orderType: 'EXCHANGE' }, tables, cfg).shippingFee).toBe(10000);
  });

  it('adds 14% VAT only when the merchant has VAT enabled', () => {
    const r = calculatePrice({ ...input, vatEnabled: true }, tables, cfg);
    expect(r.vatAmount).toBe(1120);
    expect(r.totalFees).toBe(9120);
  });

  it('charges no COD fee at or below 3,000 EGP', () => {
    expect(calculatePrice({ ...input, codAmount: 300000 }, tables, cfg).codFee).toBe(0);
  });

  it('charges 1% on COD above 3,000 EGP (excess mode by default)', () => {
    expect(calculatePrice({ ...input, codAmount: 500000 }, tables, cfg).codFee).toBe(2000);
  });

  it('can charge 1% on the full COD (full mode)', () => {
    expect(calculatePrice({ ...input, codAmount: 500000 }, tables, { ...cfg, codFeeMode: 'full' }).codFee).toBe(5000);
  });

  it('adds the 7 EGP open package fee', () => {
    expect(calculatePrice({ ...input, allowOpenPackage: true }, tables, cfg).openPackageFee).toBe(700);
  });

  it('applies size surcharge and tier discount', () => {
    const r = calculatePrice({ ...input, size: 'LARGE', tier: 'GOLD' }, { ...tables, sizeAdd: 1000, tierMultiplierBp: 9000 }, cfg);
    expect(r.shippingFee).toBe(8100);
  });

  it('an exact matrix override wins', () => {
    const r = calculatePrice({ ...input, orderType: 'EXCHANGE' }, { ...tables, overridePrice: 6500 }, cfg);
    expect(r.shippingFee).toBe(6500);
  });

  it('full example: VAT also on fees', () => {
    const r = calculatePrice({ ...input, codAmount: 400000, allowOpenPackage: true, vatEnabled: true }, tables, cfg);
    // shipping 8000 + cod fee 1000 + open 700 = 9700, VAT 14% = 1358
    expect(r).toMatchObject({ shippingFee: 8000, codFee: 1000, openPackageFee: 700, vatAmount: 1358, totalFees: 11058 });
  });

  it('only ever produces integers', () => {
    for (let cod = 0; cod < 1_000_000; cod += 33_333) {
      const r = calculatePrice({ ...input, codAmount: cod, vatEnabled: true, orderType: 'EXCHANGE' }, { ...tables, zoneBasePrice: 8333 }, cfg);
      for (const v of [r.shippingFee, r.codFee, r.vatAmount, r.totalFees, r.failedDeliveryFee]) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('rejects non integer money', () => {
    expect(() => calculatePrice({ ...input, codAmount: 10.5 }, tables, cfg)).toThrow();
    expect(() => applyBp(1.5, 100)).toThrow();
  });

  it('rounds half up', () => {
    expect(applyBp(1, 5000)).toBe(1); // 0.5 → 1
    expect(applyBp(3, 5000)).toBe(2); // 1.5 → 2
    expect(applyBp(1, 4999)).toBe(0);
  });
});

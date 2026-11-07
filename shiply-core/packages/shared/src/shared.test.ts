import { applyBp, egpToPiastres, formatEgp } from './money';
import { isValidTrackingNumber, makeTrackingNumber } from './tracking';
import { nextHop } from './routing';
import { addBusinessDays, cairoClock, promisedDate } from './dates';
import { codFee, returnFee, shippingFee } from './pricing';
import { canTransition } from './statuses';
import { normalizeEgyptPhone } from './phone';

describe('money', () => {
  it('rounds basis points half up with integers', () => {
    expect(applyBp(1000, 100)).toBe(10);
    expect(applyBp(150, 5000)).toBe(75);
    expect(applyBp(151, 5000)).toBe(76);
    expect(applyBp(0, 100)).toBe(0);
  });
  it('parses EGP text', () => {
    expect(egpToPiastres('125.5')).toBe(12550);
    expect(egpToPiastres('80')).toBe(8000);
    expect(egpToPiastres('1.234')).toBeNull();
    expect(egpToPiastres('-5')).toBeNull();
  });
  it('formats', () => {
    expect(formatEgp(125050)).toBe('1,250.50 EGP');
  });
});

describe('tracking numbers', () => {
  it('round trips with a check digit', () => {
    const n = makeTrackingNumber('SHP', 1000);
    expect(n).toMatch(/^SHP\d{10}$/);
    expect(isValidTrackingNumber(n, 'SHP')).toBe(true);
  });
  it('rejects a typo', () => {
    const n = makeTrackingNumber('SHP', 123456);
    const wrong = n.slice(0, -2) + String((Number(n.at(-2)) + 1) % 10) + n.at(-1);
    expect(isValidTrackingNumber(wrong, 'SHP')).toBe(false);
  });
});

describe('routing', () => {
  const base = { originHubId: 'A', destinationHubId: 'B', sortingHubId: 'S' };
  it('sends a parcel from its pickup hub to sorting', () => {
    expect(nextHop({ ...base, direction: 'FORWARD', currentHubId: 'A' })).toBe('S');
  });
  it('sends from sorting to the delivery hub', () => {
    expect(nextHop({ ...base, direction: 'FORWARD', currentHubId: 'S' })).toBe('B');
  });
  it('is ready at the delivery hub', () => {
    expect(nextHop({ ...base, direction: 'FORWARD', currentHubId: 'B' })).toBeNull();
  });
  it('routes returns back to the merchant hub', () => {
    expect(nextHop({ ...base, direction: 'RETURN', currentHubId: 'B' })).toBe('S');
    expect(nextHop({ ...base, direction: 'RETURN', currentHubId: 'S' })).toBe('A');
    expect(nextHop({ ...base, direction: 'RETURN', currentHubId: 'A' })).toBeNull();
  });
  it('goes direct when the sorting hub is the target', () => {
    expect(nextHop({ ...base, destinationHubId: 'S', direction: 'FORWARD', currentHubId: 'A' })).toBe('S');
  });
});

describe('promise dates', () => {
  it('reads Cairo time', () => {
    // 2026-11-05 is a Thursday. 15:00 UTC is 17:00 in Cairo (UTC+2 in winter).
    const c = cairoClock(new Date('2026-11-05T15:00:00Z'));
    expect(c.date).toBe('2026-11-05');
    expect(c.minutes).toBe(17 * 60);
  });
  it('skips Friday', () => {
    expect(addBusinessDays('2026-11-05', 1, [5])).toBe('2026-11-07');
  });
  it('is next day before cutoff and two days after', () => {
    const before = new Date('2026-11-08T10:00:00Z'); // Sunday 12:00 Cairo
    const after = new Date('2026-11-08T17:00:00Z'); // Sunday 19:00 Cairo
    expect(promisedDate(before, 1, '18:00', [5])).toBe('2026-11-09');
    expect(promisedDate(after, 1, '18:00', [5])).toBe('2026-11-10');
  });
});

describe('pricing', () => {
  const zone = { priceS: 6000, priceM: 7000, priceL: 9000, priceXL: 12000 };
  const fees = { codFeeBp: 100, codFreeAmount: 300000, returnFeeBp: 5000 };
  it('applies size and merchant discount', () => {
    expect(shippingFee(zone, 'M', 0)).toBe(7000);
    expect(shippingFee(zone, 'M', 1000)).toBe(6300);
  });
  it('charges COD fee only above the free amount', () => {
    expect(codFee(300000, fees)).toBe(0);
    expect(codFee(400000, fees)).toBe(1000);
  });
  it('charges half shipping on return', () => {
    expect(returnFee(7000, fees)).toBe(3500);
  });
});

describe('status machine', () => {
  it('allows the happy path and blocks skipping', () => {
    expect(canTransition('CREATED', 'PICKED_UP')).toBe(true);
    expect(canTransition('AT_HUB', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition('CREATED', 'DELIVERED')).toBe(false);
    expect(canTransition('DELIVERED', 'AT_HUB')).toBe(false);
  });
});

describe('phones', () => {
  it('normalizes Egyptian mobiles', () => {
    expect(normalizeEgyptPhone('01012345678')).toBe('+201012345678');
    expect(normalizeEgyptPhone('+20 101 234 5678')).toBe('+201012345678');
    expect(normalizeEgyptPhone('0221234567')).toBeNull();
  });
});

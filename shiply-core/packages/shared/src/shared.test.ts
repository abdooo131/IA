import { applyBp, egpToPiastres, formatEgp } from './money';
import { isValidTrackingNumber, makeTrackingNumber } from './tracking';
import { distanceKm, nearest, nextHop } from './routing';
import { addBusinessDays, cairoClock, cairoTimeToUtc, promisedDate } from './dates';
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
  // OBR feeds GIZ; ALXSF feeds ALX. Merchant belongs to OBR.
  const hubs = new Map([
    ['OBR', { id: 'OBR', isSorting: true, parentId: null }],
    ['ALXSF', { id: 'ALXSF', isSorting: true, parentId: null }],
    ['GIZ', { id: 'GIZ', isSorting: false, parentId: 'OBR' }],
    ['ALX', { id: 'ALX', isSorting: false, parentId: 'ALXSF' }],
  ]);
  const hop = (direction: 'FORWARD' | 'RETURN', currentHubId: string, destinationHubId: string) =>
    nextHop({ direction, currentHubId, originHubId: 'OBR', destinationHubId }, hubs);
  it('sends from the facility straight to a hub it feeds', () => {
    expect(hop('FORWARD', 'OBR', 'GIZ')).toBe('GIZ');
    expect(hop('FORWARD', 'GIZ', 'GIZ')).toBeNull();
  });
  it('line hauls to the facility that feeds a far hub', () => {
    expect(hop('FORWARD', 'OBR', 'ALX')).toBe('ALXSF');
    expect(hop('FORWARD', 'ALXSF', 'ALX')).toBe('ALX');
  });
  it('brings returns back through the facilities to the merchant facility', () => {
    expect(hop('RETURN', 'ALX', 'ALX')).toBe('ALXSF');
    expect(hop('RETURN', 'ALXSF', 'ALX')).toBe('OBR');
    expect(hop('RETURN', 'OBR', 'ALX')).toBeNull();
    expect(hop('RETURN', 'GIZ', 'GIZ')).toBe('OBR');
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
    expect(canTransition('AT_INBOUND', 'SORTED')).toBe(true);
    expect(canTransition('SORTED', 'IN_TRANSIT')).toBe(false); // outbound must bag it first
    expect(canTransition('AT_INBOUND', 'OUT_FOR_DELIVERY')).toBe(false);
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

describe('nearest facility', () => {
  it('picks the closest by distance', () => {
    const obour = { id: 'OBR', lat: 30.2, lng: 31.47 };
    const alex = { id: 'ALXSF', lat: 31.2, lng: 29.92 };
    expect(nearest({ lat: 30.09, lng: 31.32 }, [obour, alex])?.id).toBe('OBR'); // Heliopolis
    expect(nearest({ lat: 31.04, lng: 30.47 }, [obour, alex])?.id).toBe('ALXSF'); // Damanhour
    expect(Math.round(distanceKm(obour, alex))).toBeGreaterThan(150);
  });
});

describe('shift times', () => {
  it('turns a Cairo wall clock time into the right instant', () => {
    expect(cairoTimeToUtc('2026-11-08', '09:00').toISOString()).toBe('2026-11-08T07:00:00.000Z'); // winter, UTC+2
    expect(cairoTimeToUtc('2026-07-08', '09:00').toISOString()).toBe('2026-07-08T06:00:00.000Z'); // summer, UTC+3
  });
});

describe('splitVat', () => {
  it('takes 14% VAT out of a price that includes it', async () => {
    const { splitVat } = await import('./money');
    expect(splitVat(11400, 1400)).toEqual({ net: 10000, vat: 1400 });
    expect(splitVat(6000, 1400)).toEqual({ net: 5263, vat: 737 });
    expect(splitVat(0, 1400)).toEqual({ net: 0, vat: 0 });
    const s = splitVat(999, 1400);
    expect(s.net + s.vat).toBe(999);
  });
});

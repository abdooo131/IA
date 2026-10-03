import {
  ALLOWED_TRANSITIONS,
  GOVERNORATES,
  ORDER_STATUSES,
  STATUS_GROUP_OF,
  buildTrackingNumber,
  canTransition,
  egpToPiastres,
  isValidTrackingNumber,
  normalizeEgyptianPhone,
} from './index';

describe('Egyptian phone validation', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['+201112345678', '+201112345678'],
    ['00201212345678', '+201212345678'],
    ['201512345678', '+201512345678'],
    ['010 1234 5678', '+201012345678'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeEgyptianPhone(input)).toBe(expected);
  });

  it.each(['0101234567', '010123456789', '01312345678', '0221234567', 'abc', '', '+1 555 1234567'])(
    'rejects %s',
    (input) => {
      expect(normalizeEgyptianPhone(input)).toBeNull();
    },
  );
});

describe('money parsing', () => {
  it('converts EGP strings to integer piastres', () => {
    expect(egpToPiastres('80')).toBe(8000);
    expect(egpToPiastres('1,250.5')).toBe(125050);
    expect(egpToPiastres('0.07')).toBe(7);
    expect(egpToPiastres('1.234')).toBeNull();
    expect(egpToPiastres('-5')).toBeNull();
  });
});

describe('tracking numbers', () => {
  it('round trips the check digit', () => {
    for (const seq of [1, 42, 123456, 999999999]) {
      const tn = buildTrackingNumber('SHP', seq);
      expect(tn).toHaveLength(13);
      expect(isValidTrackingNumber('SHP', tn)).toBe(true);
    }
  });
  it('detects a typo', () => {
    const tn = buildTrackingNumber('SHP', 123456);
    const bad = tn.slice(0, 5) + ((parseInt(tn[5], 10) + 1) % 10) + tn.slice(6);
    expect(isValidTrackingNumber('SHP', bad)).toBe(false);
  });
});

describe('status machine table', () => {
  it('every status has a group and a transitions entry', () => {
    for (const s of ORDER_STATUSES) {
      expect(STATUS_GROUP_OF[s]).toBeDefined();
      expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
    }
  });
  it('only references known statuses', () => {
    for (const targets of Object.values(ALLOWED_TRANSITIONS)) {
      for (const t of targets) expect(ORDER_STATUSES).toContain(t);
    }
  });
  it('follows the default forward flow', () => {
    const flow = [
      'NEW', 'PENDING_PICKUP', 'PICKED_UP', 'AT_SORTING_FACILITY', 'IN_TRANSFER',
      'AT_LAST_MILE_HUB', 'ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER', 'DELIVERED',
    ] as const;
    for (let i = 0; i < flow.length - 1; i++) expect(canTransition(flow[i], flow[i + 1])).toBe(true);
  });
  it('follows the return flow', () => {
    const flow = ['AT_LAST_MILE_HUB', 'RETURNS_ON_WAY', 'AT_SORTING_FACILITY', 'HEADING_TO_MERCHANT', 'RETURNED'] as const;
    for (let i = 0; i < flow.length - 1; i++) expect(canTransition(flow[i], flow[i + 1])).toBe(true);
  });
  it('terminal statuses cannot move', () => {
    expect(ALLOWED_TRANSITIONS.TERMINATED).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS.ARCHIVED).toHaveLength(0);
    expect(canTransition('DELIVERED', 'NEW')).toBe(false);
  });
});

describe('governorates', () => {
  it('has all 27 with unique codes', () => {
    expect(GOVERNORATES).toHaveLength(27);
    expect(new Set(GOVERNORATES.map((g) => g.code)).size).toBe(27);
  });
});

import { roleAllowedInApp } from './auth.service';

describe('app login separation', () => {
  it('driver apps never share a login', () => {
    expect(roleAllowedInApp('PICKUP_DRIVER', 'pickup')).toBe(true);
    expect(roleAllowedInApp('PICKUP_DRIVER', 'delivery')).toBe(false);
    expect(roleAllowedInApp('DELIVERY_DRIVER', 'delivery')).toBe(true);
    expect(roleAllowedInApp('DELIVERY_DRIVER', 'pickup')).toBe(false);
  });
  it('merchants only use the merchant portal, staff only ops', () => {
    expect(roleAllowedInApp('MERCHANT_OWNER', 'merchant')).toBe(true);
    expect(roleAllowedInApp('MERCHANT_OWNER', 'ops')).toBe(false);
    expect(roleAllowedInApp('OPERATIONS_MANAGER', 'ops')).toBe(true);
    expect(roleAllowedInApp('OPERATIONS_MANAGER', 'merchant')).toBe(false);
    expect(roleAllowedInApp('PICKUP_DRIVER', 'ops')).toBe(false);
  });
});

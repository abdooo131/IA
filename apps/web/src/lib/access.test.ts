import { describe, expect, it } from 'vitest';
import { areaOf, decideAccess, homeFor, loginRenewal, safeNext } from './access';

describe('areaOf', () => {
  it('matches an area and its sub paths only', () => {
    expect(areaOf('/admin')).toBe('/admin');
    expect(areaOf('/store/receive')).toBe('/store');
    expect(areaOf('/administrator')).toBeNull();
    expect(areaOf('/login')).toBeNull();
  });
});

describe('homeFor', () => {
  it('sends each role to its area', () => {
    expect(homeFor('admin')).toBe('/home');
    expect(homeFor('store_staff')).toBe('/store');
    expect(homeFor('rider')).toBe('/rider');
    expect(homeFor('merchant')).toBe('/merchant');
    expect(homeFor('finance')).toBe('/home');
  });
});

describe('safeNext', () => {
  it.each([
    ['/store?x=1', '/store?x=1'],
    ['//evil.example', null],
    ['https://evil.example', null],
    ['/\\evil.example', null],
    ['/\t/evil.example', null],
    ['/\n/evil.example', null],
    ['/\r//evil.example', null],
    ['/\u0000x', null],
    ['/%09/evil.example', '/%09/evil.example'],
    ['/./\t/evil.example', null],
    ['/a/../b?c=1#d', '/b?c=1#d'],
    ['', null],
    [null, null],
  ])('%s gives %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('decideAccess', () => {
  const base = { search: '', hasRefreshToken: false };

  it('leaves public pages alone', () => {
    expect(decideAccess({ ...base, pathname: '/login', role: null })).toEqual({ kind: 'allow' });
  });

  it('sends a signed out visitor to login with the page to come back to', () => {
    expect(decideAccess({ ...base, pathname: '/rider', search: '?a=1', role: null })).toEqual({
      kind: 'login',
      next: '/rider?a=1',
    });
  });

  it('tries a refresh first when a refresh token is present', () => {
    expect(
      decideAccess({ ...base, pathname: '/store', role: null, hasRefreshToken: true }),
    ).toEqual({ kind: 'refresh', next: '/store' });
  });

  it('allows the right roles', () => {
    expect(decideAccess({ ...base, pathname: '/store', role: 'store_staff' }).kind).toBe('allow');
    expect(decideAccess({ ...base, pathname: '/rider', role: 'rider' }).kind).toBe('allow');
    expect(decideAccess({ ...base, pathname: '/store', role: 'admin' }).kind).toBe('allow');
  });

  it('sends the wrong role to its own home', () => {
    expect(decideAccess({ ...base, pathname: '/admin', role: 'rider' })).toEqual({
      kind: 'redirect',
      to: '/rider',
    });
    expect(decideAccess({ ...base, pathname: '/store', role: 'merchant' })).toEqual({
      kind: 'redirect',
      to: '/merchant',
    });
    expect(decideAccess({ ...base, pathname: '/merchant', role: 'admin' })).toEqual({
      kind: 'redirect',
      to: '/home',
    });
  });
});

describe('team areas', () => {
  const base = { search: '', hasRefreshToken: false };

  it('are open to every team role; the API decides what each person sees', () => {
    for (const role of ['admin', 'finance', 'store_staff'] as const)
      for (const pathname of ['/home', '/admin/orders', '/finance', '/store'])
        expect(decideAccess({ ...base, pathname, role }).kind).toBe('allow');
  });

  it('stay closed to riders and merchants', () => {
    expect(decideAccess({ ...base, pathname: '/home', role: 'rider' })).toEqual({
      kind: 'redirect',
      to: '/rider',
    });
    expect(decideAccess({ ...base, pathname: '/finance', role: 'merchant' })).toEqual({
      kind: 'redirect',
      to: '/merchant',
    });
  });

  it('keep the rider app for riders and admins', () => {
    expect(decideAccess({ ...base, pathname: '/rider', role: 'store_staff' })).toEqual({
      kind: 'redirect',
      to: '/store',
    });
    expect(decideAccess({ ...base, pathname: '/rider', role: 'finance' })).toEqual({
      kind: 'redirect',
      to: '/home',
    });
  });
});

describe('pages open to every signed in role', () => {
  const base = { search: '', hasRefreshToken: false };
  const pages = [
    '/tickets',
    '/tickets/abc',
    '/notifications',
    '/help',
    '/my-file/payslips/2026-10',
  ];

  it('renew an expired access cookie instead of asking to sign in', () => {
    for (const pathname of pages)
      expect(decideAccess({ ...base, pathname, role: null, hasRefreshToken: true })).toEqual({
        kind: 'refresh',
        next: pathname,
      });
  });

  it('ask to sign in without a refresh cookie', () => {
    expect(decideAccess({ ...base, pathname: '/help', role: null }).kind).toBe('login');
  });

  it('are open to every role', () => {
    for (const role of ['admin', 'finance', 'store_staff', 'rider', 'merchant'] as const)
      for (const pathname of pages)
        expect(decideAccess({ ...base, pathname, role }).kind).toBe('allow');
  });
});

describe('loginRenewal', () => {
  const base = {
    next: null,
    hasRefreshToken: true,
    hasValidAccessToken: false,
    renewFailed: false,
  };

  it('renews on the sign in page when only the refresh cookie is left', () => {
    expect(loginRenewal(base)).toBe('/auth/refresh?next=%2Flogin');
    expect(loginRenewal({ ...base, next: '/store?x=1' })).toBe(
      '/auth/refresh?next=%2Fstore%3Fx%3D1',
    );
  });

  it('shows the form otherwise, and never loops after a renewal that failed', () => {
    expect(loginRenewal({ ...base, hasRefreshToken: false })).toBeNull();
    expect(loginRenewal({ ...base, hasValidAccessToken: true })).toBeNull();
    expect(loginRenewal({ ...base, renewFailed: true })).toBeNull();
  });
});

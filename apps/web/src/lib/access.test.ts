import { describe, expect, it } from 'vitest';
import { areaOf, decideAccess, homeFor, safeNext } from './access';

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
    expect(homeFor('admin')).toBe('/admin');
    expect(homeFor('store_staff')).toBe('/store');
    expect(homeFor('rider')).toBe('/rider');
    expect(homeFor('merchant')).toBeNull();
  });
});

describe('safeNext', () => {
  it.each([
    ['/store?x=1', '/store?x=1'],
    ['//evil.example', null],
    ['https://evil.example', null],
    ['/\\evil.example', null],
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
      to: '/',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { loginSchema } from './auth';
import { isRole, ROLES } from './roles';

describe('loginSchema', () => {
  it('trims and lowercases the email', () => {
    expect(loginSchema.parse({ email: '  Admin@Shiply.EG ', password: 'x' })).toEqual({
      email: 'admin@shiply.eg',
      password: 'x',
    });
  });

  it('rejects a bad email and an empty password', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.eg', password: '' }).success).toBe(false);
  });
});

describe('roles', () => {
  it('has the Shiply Now roles and the parcel network roles', () => {
    expect(ROLES).toEqual([
      'admin',
      'merchant',
      'store_staff',
      'rider',
      'finance',
      'hub_staff',
      'courier',
      'agent',
    ]);
  });

  it('guards role strings', () => {
    expect(isRole('rider')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

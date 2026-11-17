import { describe, expect, it } from 'vitest';
import { r2Config, validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('refuses a short JWT secret', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('parses COOKIE_SECURE', () => {
    expect(validateEnv({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  const r2 = {
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'key-id',
    R2_SECRET_ACCESS_KEY: 'very-secret-value',
    R2_BUCKET: 'shiplynow-files',
  };

  it('takes R2 with all four values, or none', () => {
    expect(r2Config(validateEnv(base))).toBeNull();
    expect(r2Config(validateEnv({ ...base, ...r2 }))).toEqual({
      accountId: r2.R2_ACCOUNT_ID,
      accessKeyId: r2.R2_ACCESS_KEY_ID,
      secretAccessKey: r2.R2_SECRET_ACCESS_KEY,
      bucket: r2.R2_BUCKET,
    });
  });

  it('refuses some R2 values without the others, never showing a value', () => {
    let message = '';
    try {
      validateEnv({ ...base, ...r2, R2_BUCKET: '' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/R2_BUCKET/);
    expect(message).not.toContain(r2.R2_SECRET_ACCESS_KEY);
    expect(() => validateEnv({ ...base, ...r2, R2_ACCOUNT_ID: 'not-an-id' })).toThrow(
      /R2_ACCOUNT_ID/,
    );
  });
});

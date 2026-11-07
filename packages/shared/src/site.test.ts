import { describe, expect, it } from 'vitest';
import { latinDigits, siteLeadFieldErrors, siteLeadSchema, siteLeadUpdateSchema } from './site';

const lead = {
  name: 'Mona Adel',
  phone: '010 1234 5678',
  website: 'mystore.com',
  ordersBand: '300_1000',
  locale: 'ar',
  idempotencyKey: 'key-12345678',
};

describe('site lead form', () => {
  it('accepts a lead and turns an empty website into none', () => {
    expect(siteLeadSchema.parse({ ...lead, website: '  ' }).website).toBeNull();
    expect(siteLeadSchema.parse(lead).locale).toBe('ar');
  });

  it('names the field of each problem', () => {
    expect(siteLeadFieldErrors(lead)).toBeNull();
    expect(siteLeadFieldErrors({ ...lead, name: ' ', phone: '', ordersBand: 'lots' })).toEqual({
      name: 'name_required',
      phone: 'phone_required',
      ordersBand: 'orders_band_required',
    });
    expect(siteLeadFieldErrors({ ...lead, phone: '12' })).toEqual({ phone: 'phone_short' });
    // A number that is not an Egyptian mobile is still accepted (the lead is flagged).
    expect(siteLeadFieldErrors({ ...lead, phone: '+44 20 7946 0958' })).toBeNull();
  });

  it('reads Arabic-Indic digits', () => {
    expect(latinDigits('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
    expect(siteLeadFieldErrors({ ...lead, phone: '٠١٠١٢٣٤٥٦٧٨' })).toBeNull();
  });

  it('updates a status, a note or both, never nothing', () => {
    expect(siteLeadUpdateSchema.parse({ status: 'won' })).toEqual({ status: 'won' });
    expect(siteLeadUpdateSchema.parse({ note: ' ' })).toEqual({ note: null });
    expect(siteLeadUpdateSchema.safeParse({}).success).toBe(false);
    expect(siteLeadUpdateSchema.safeParse({ status: 'maybe' }).success).toBe(false);
  });
});

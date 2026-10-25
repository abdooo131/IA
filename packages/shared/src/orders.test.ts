import { describe, expect, it } from 'vitest';
import {
  completeDeliverySchema,
  createOrderSchema,
  currentStageDue,
  newDeliveryOtp,
} from './orders';

const sla = { accept: 2, pick: 10, pack: 5, handover: 5, ride: 35 };
const t0 = new Date('2026-01-14T10:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const base = {
  placedAt: t0,
  acceptedAt: null,
  pickedAt: null,
  packedAt: null,
  outForDeliveryAt: null,
};

describe('currentStageDue', () => {
  it('times each stage from when it started', () => {
    expect(currentStageDue({ ...base, status: 'new' }, sla)).toEqual({
      stage: 'accept',
      dueAt: at(2),
    });
    expect(currentStageDue({ ...base, status: 'accepted', acceptedAt: at(1) }, sla)).toEqual({
      stage: 'pick',
      dueAt: at(11),
    });
    expect(
      currentStageDue({ ...base, status: 'picking', acceptedAt: at(1), pickedAt: at(6) }, sla),
    ).toEqual({
      stage: 'pack',
      dueAt: at(11),
    });
    expect(currentStageDue({ ...base, status: 'packed', packedAt: at(9) }, sla)).toEqual({
      stage: 'handover',
      dueAt: at(14),
    });
    expect(
      currentStageDue({ ...base, status: 'out_for_delivery', outForDeliveryAt: at(12) }, sla),
    ).toEqual({
      stage: 'ride',
      dueAt: at(47),
    });
  });

  it('has no stage for closed orders', () => {
    expect(currentStageDue({ ...base, status: 'delivered' }, sla)).toBeNull();
    expect(currentStageDue({ ...base, status: 'moved_to_standard' }, sla)).toBeNull();
  });
});

describe('order schemas', () => {
  const order = {
    customerName: 'Sara Ali',
    customerPhone: '01012345678',
    addressText: '12 Road 9, Maadi',
    latitude: 29.96,
    longitude: 31.26,
    paymentMethod: 'cod',
    items: [{ skuId: 's1', quantity: 2 }],
  };

  it('accepts a normal order and defaults the delivery fee to 0', () => {
    expect(createOrderSchema.parse(order).deliveryFeePiastres).toBe(0);
  });

  it('refuses the same product twice and an empty basket', () => {
    expect(
      createOrderSchema.safeParse({ ...order, items: [order.items[0], order.items[0]] }).success,
    ).toBe(false);
    expect(createOrderSchema.safeParse({ ...order, items: [] }).success).toBe(false);
  });

  it('needs an OTP or a photo to complete a delivery', () => {
    expect(completeDeliverySchema.safeParse({}).success).toBe(false);
    expect(completeDeliverySchema.safeParse({ otp: '0420' }).success).toBe(true);
    expect(completeDeliverySchema.safeParse({ otp: '42' }).success).toBe(false);
    expect(completeDeliverySchema.safeParse({ photoId: 'p1' }).success).toBe(true);
  });

  it('makes 4 digit codes, keeping leading zeros', () => {
    expect(newDeliveryOtp(() => 0.0042)).toBe('0042');
    expect(newDeliveryOtp(() => 0.99999)).toBe('9999');
  });
});

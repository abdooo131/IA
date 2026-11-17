import { describe, expect, it } from 'vitest';
import {
  attemptsMade,
  callLog,
  orderPhotos,
  orderSteps,
  plainStateKey,
  promiseOutcome,
  shopifyRef,
} from './order-detail';
import type { OrderDetail } from './order-types';

type Delivery = OrderDetail['deliveries'][number];

const delivery = (over: Partial<Delivery>): Delivery => ({
  id: 'd1',
  status: 'assigned',
  rider: 'Ahmed',
  badge: 'RDR-0001',
  tripId: null,
  pickedUpAt: null,
  deliveredAt: null,
  failedAt: null,
  failedReason: null,
  callAttempts: 0,
  failedPhotoId: null,
  returnedAt: null,
  otpVerified: false,
  proofPhotoId: null,
  codExpectedPiastres: 0,
  codCollectedPiastres: null,
  ...over,
});

const order = (over: Partial<OrderDetail>): OrderDetail =>
  ({
    status: 'new',
    placedAt: '2026-11-06T10:00:00Z',
    acceptedAt: null,
    pickingStartedAt: null,
    packedAt: null,
    outForDeliveryAt: null,
    deliveredAt: null,
    closedAt: null,
    slaDueAt: '2026-11-06T11:00:00Z',
    slaStartsAt: null,
    stage: null,
    packPhotoId: null,
    deliveries: [],
    events: [],
    ...over,
  }) as OrderDetail;

describe('order page helpers', () => {
  it('lights the path up to the current step with the times reached', () => {
    const steps = orderSteps(
      order({
        status: 'picking',
        acceptedAt: '2026-11-06T10:01:00Z',
        pickingStartedAt: '2026-11-06T10:03:00Z',
      }),
    );
    expect(steps.map((s) => [s.status, s.state])).toEqual([
      ['new', 'done'],
      ['accepted', 'done'],
      ['picking', 'current'],
      ['packed', 'todo'],
      ['out_for_delivery', 'todo'],
      ['delivered', 'todo'],
    ]);
    expect(steps[1]!.at).toBe('2026-11-06T10:01:00Z');
  });

  it('puts a side state in red after the last step reached', () => {
    const failed = order({
      status: 'attempt_failed',
      acceptedAt: '2026-11-06T10:01:00Z',
      pickingStartedAt: '2026-11-06T10:02:00Z',
      packedAt: '2026-11-06T10:10:00Z',
      outForDeliveryAt: '2026-11-06T10:15:00Z',
      deliveries: [
        delivery({ status: 'failed', failedAt: '2026-11-06T10:40:00Z', pickedUpAt: 'x' }),
      ],
    });
    const steps = orderSteps(failed);
    expect(steps.map((s) => s.status)).toEqual([
      'new',
      'accepted',
      'picking',
      'packed',
      'out_for_delivery',
      'attempt_failed',
      'delivered',
    ]);
    expect(steps[5]).toEqual({
      status: 'attempt_failed',
      at: '2026-11-06T10:40:00Z',
      state: 'side',
    });
    expect(attemptsMade(failed)).toBe(1);
  });

  it('reads the call log newest first and the photos of every attempt', () => {
    const o = order({
      packPhotoId: 'p1',
      packedAt: '2026-11-06T10:10:00Z',
      deliveries: [delivery({ failedPhotoId: 'p2', failedAt: '2026-11-06T10:40:00Z' })],
      events: [
        { at: '2026-11-06T10:30:00Z', type: 'customer_called', by: 'Ahmed', data: { attempt: 1 } },
        { at: '2026-11-06T10:35:00Z', type: 'customer_called', by: 'Ahmed', data: { attempt: 2 } },
        { at: '2026-11-06T10:36:00Z', type: 'late', by: null, data: null },
      ],
    });
    expect(callLog(o).map((c) => c.attempt)).toEqual([2, 1]);
    expect(orderPhotos(o).map((p) => p.kind)).toEqual(['pack', 'door']);
  });

  it('says whether the promise was kept', () => {
    expect(
      promiseOutcome(order({ status: 'delivered', deliveredAt: '2026-11-06T10:50:00Z' })),
    ).toBe('on_time');
    expect(
      promiseOutcome(order({ status: 'delivered', deliveredAt: '2026-11-06T11:05:00Z' })),
    ).toBe('late');
    expect(promiseOutcome(order({ status: 'packed' }), new Date('2026-11-06T11:01:00Z'))).toBe(
      'late',
    );
    expect(promiseOutcome(order({ status: 'cancelled' }))).toBeNull();
  });

  it('knows an order waiting for the store to open, and Shopify ids', () => {
    const now = new Date('2026-11-06T05:00:00Z');
    expect(plainStateKey(order({ slaStartsAt: '2026-11-06T07:00:00Z' }), now)).toBe('waitingOpen');
    expect(plainStateKey(order({ status: 'picking' }), now)).toBe('picking');
    expect(shopifyRef('gid://shopify/Order/5551234')).toBe('5551234');
    expect(shopifyRef(null)).toBeNull();
  });
});

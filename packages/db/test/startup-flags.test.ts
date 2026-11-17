import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDemo } from '../src/demo';
import { freshStart, FRESH_START_CONFIRMATION } from '../src/fresh-start';
import { createOrder } from '../src/orders';
import { holdsDemo, raiseStartupAlert, realOrderCount } from '../src/startup-flags';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 2 });
  await createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Real customer',
    customerPhone: '01012345678',
    addressText: '12 Road 9, Maadi',
    paymentMethod: 'cod',
    deliveryFeePiastres: 2000,
    items: [{ skuId: f.sku.id, quantity: 1 }],
    actorUserId: null,
  });
});

afterEach(() => {
  delete process.env.DEMO_LOAD;
});
afterAll(() => prisma.$disconnect());

describe('start up switches', () => {
  it('never loads the demo month over orders of real merchants', async () => {
    expect(await realOrderCount(prisma)).toBe(1);
    process.env.DEMO_LOAD = 'true';
    expect(await loadDemo(prisma, { demoPassword: 'demo-password-1', days: 1 })).toEqual({
      status: 'real_data_found',
    });
    expect(await holdsDemo(prisma)).toBe(false);
  });

  it('never wipes a database that does not hold the demo month', async () => {
    await expect(freshStart(prisma, { confirm: FRESH_START_CONFIRMATION })).rejects.toThrow(
      'fresh_start_no_demo',
    );
    expect(await prisma.order.count()).toBe(1);
  });

  it('shows a switch left on as one admin alert until it is handled', async () => {
    expect(await raiseStartupAlert(prisma, 'DEMO_LOAD', 'jobs_disabled')).toEqual({
      raised: true,
    });
    expect(await raiseStartupAlert(prisma, 'DEMO_LOAD', 'jobs_disabled')).toEqual({
      raised: false,
    });
    await raiseStartupAlert(prisma, 'FRESH_START', 'fresh_start_done');
    expect(await prisma.alert.count({ where: { type: 'startup_flag' } })).toBe(2);
    await prisma.alert.updateMany({
      where: { type: 'startup_flag' },
      data: { resolvedAt: new Date() },
    });
    expect(await raiseStartupAlert(prisma, 'DEMO_LOAD', 'jobs_disabled')).toEqual({
      raised: true,
    });
    const alert = await prisma.alert.findFirstOrThrow({
      where: { type: 'startup_flag', resolvedAt: null },
    });
    expect(alert.data).toEqual({ flag: 'DEMO_LOAD', state: 'jobs_disabled' });
  });
});

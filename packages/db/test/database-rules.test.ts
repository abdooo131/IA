import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
});

afterAll(() => prisma.$disconnect());

describe('append only tables', () => {
  it('stock_movements rejects UPDATE and DELETE', async () => {
    const { movement } = await receive(prisma, {
      skuId: f.sku.id,
      binId: f.shelfA.id,
      quantity: 1,
    });
    await expect(
      prisma.stockMovement.update({ where: { id: movement.id }, data: { quantity: 99 } }),
    ).rejects.toThrow(/append only/);
    await expect(prisma.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow(
      /append only/,
    );
  });

  it('audit_log rejects UPDATE and DELETE', async () => {
    const entry = await prisma.auditLog.create({
      data: { action: 'x', entityType: 'x', entityId: 'x' },
    });
    await expect(
      prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'changed' } }),
    ).rejects.toThrow(/append only/);
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow(/append only/);
  });

  it('order_events rejects UPDATE and DELETE', async () => {
    const order = await prisma.order.create({
      data: {
        number: 'SN-1',
        merchantId: f.merchant.id,
        darkStoreId: f.store.id,
        customerName: 'x',
        customerPhone: '+201000000000',
        addressText: 'x',
        paymentMethod: 'cod',
        subtotalPiastres: 1000,
        placedAt: new Date(),
      },
    });
    const event = await prisma.orderEvent.create({ data: { orderId: order.id, type: 'created' } });
    await expect(
      prisma.orderEvent.update({ where: { id: event.id }, data: { type: 'changed' } }),
    ).rejects.toThrow(/append only/);
    await expect(prisma.orderEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append only/,
    );
  });
});

describe('check constraints', () => {
  it('stock levels can never be negative or over reserved, even with raw writes', async () => {
    await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 2 });
    const where = { darkStoreId_skuId: { darkStoreId: f.store.id, skuId: f.sku.id } };
    await expect(prisma.stockLevel.update({ where, data: { onHand: -1 } })).rejects.toThrow(
      /stock_levels_on_hand_non_negative|check constraint/,
    );
    await expect(prisma.stockLevel.update({ where, data: { reserved: 3 } })).rejects.toThrow(
      /stock_levels_reserved_within_on_hand|check constraint/,
    );
    await expect(
      prisma.binStock.update({
        where: { binId_skuId: { binId: f.shelfA.id, skuId: f.sku.id } },
        data: { quantity: -1 },
      }),
    ).rejects.toThrow(/bin_stock_quantity_non_negative|check constraint/);
  });

  it('money cannot be negative', async () => {
    await expect(
      prisma.sku.update({ where: { id: f.sku.id }, data: { pricePiastres: -100 } }),
    ).rejects.toThrow(/skus_price_non_negative|check constraint/);
  });
});

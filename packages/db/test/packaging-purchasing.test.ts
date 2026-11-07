import { cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { acceptOrder, createOrder, packOrder, pickOrderItem } from '../src/orders';
import { savePhoto } from '../src/photos';
import {
  adjustPackaging,
  consumePackagingForOrder,
  countPackaging,
  createPackagingItem,
  packagingForOrder,
  packagingStock,
  recipeFor,
  recordPackagingPurchase,
  setPackagingRecipe,
} from '../src/packaging';
import {
  billPurchaseOrder,
  closePurchaseOrder,
  decidePurchaseOrder,
  getPurchaseOrder,
  markPurchaseOrdered,
  receivePurchaseOrder,
  requestPurchaseOrder,
} from '../src/purchasing';
import {
  balanceOf,
  cancelBill,
  createSupplier,
  ensureDefaultAccounts,
  payBill,
  recordCapital,
} from '../src/finance';
import { setSetting } from '../src/settings';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let approver: string;
let n = 0;
const key = () => `pk-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const balance = async (k: string) => balanceOf(prisma, { id: (await byKey(k)).id });

async function item(code: string, isBox = false) {
  return createPackagingItem(prisma, {
    code,
    nameEn: code,
    nameAr: code,
    isBox,
    unitCostPiastres: 100,
    actorUserId: admin,
  });
}

async function buy(itemId: string, quantity: number, amount: number, darkStoreId = f.store.id) {
  return recordPackagingPurchase(prisma, {
    darkStoreId,
    itemId,
    quantity,
    amountPiastres: amount,
    moneyAccountId: (await byKey('bank')).id,
    reference: 'Cash purchase',
    actorUserId: admin,
    idempotencyKey: key(),
  });
}

const onHand = async (itemId: string, darkStoreId = f.store.id) =>
  (
    await prisma.packagingLevel.findUnique({
      where: { darkStoreId_itemId: { darkStoreId, itemId } },
    })
  )?.onHand ?? 0;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  approver = (
    await prisma.user.create({
      data: { email: 'b@t.eg', name: 'Approver', role: 'finance', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 10_000_000,
    reference: 'Owner',
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

/** An order picked and ready to pack at the test store. */
async function pickedOrder() {
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 1 });
  const o = await createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Sara',
    customerPhone: '01012345678',
    addressText: '12 Road 9, Maadi',
    paymentMethod: 'prepaid',
    deliveryFeePiastres: 0,
    items: [{ skuId: f.sku.id, quantity: 1 }],
    actorUserId: admin,
  });
  await acceptOrder(prisma, { orderId: o.id, darkStoreId: f.store.id, actorUserId: admin });
  await pickOrderItem(prisma, {
    orderId: o.id,
    darkStoreId: f.store.id,
    skuId: f.sku.id,
    quantity: 1,
    actorUserId: admin,
    idempotencyKey: key(),
  });
  return o;
}
const packPhoto = async () =>
  (
    await savePhoto(prisma, {
      kind: 'pack',
      contentType: 'image/jpeg',
      data: Buffer.from('jpeg'),
      actorUserId: admin,
    })
  ).id;

describe('packaging stock', () => {
  it('buys packaging into a store and books it as stock, not as a cost', async () => {
    const bag = await item('BAG-M');
    await buy(bag.id, 100, 15_000);
    expect(await onHand(bag.id)).toBe(100);
    expect(await balance('packaging_stock')).toBe(15_000);
    expect(await balance('expense:packaging')).toBe(0);
    const stock = await packagingStock(prisma, { darkStoreId: f.store.id });
    expect(stock.rows.find((r) => r.item.code === 'BAG-M')).toMatchObject({
      onHand: 100,
      valuePiastres: 15_000,
      averageCostPiastres: 150,
    });
    // Merchant stock never moves for packaging.
    expect(await prisma.stockMovement.count({ where: { type: 'receive' } })).toBe(0);
  });

  it('uses the most specific recipe: merchant at the store, merchant, store, everyone', async () => {
    const bag = await item('BAG');
    const tape = await item('TAPE');
    await setPackagingRecipe(prisma, {
      lines: [{ itemId: bag.id, quantity: 1 }],
      actorUserId: admin,
    });
    await setPackagingRecipe(prisma, {
      darkStoreId: f.store.id,
      lines: [{ itemId: bag.id, quantity: 2 }],
      actorUserId: admin,
    });
    expect(await recipeFor(prisma, f.store.id, f.merchant.id)).toEqual([
      { itemId: bag.id, quantity: 2 },
    ]);
    expect(await recipeFor(prisma, f.other.id, f.merchant.id)).toEqual([
      { itemId: bag.id, quantity: 1 },
    ]);
    await setPackagingRecipe(prisma, {
      merchantId: f.merchant.id,
      lines: [
        { itemId: bag.id, quantity: 1 },
        { itemId: tape.id, quantity: 1 },
      ],
      actorUserId: admin,
    });
    expect(await recipeFor(prisma, f.store.id, f.merchant.id)).toHaveLength(2);
    // An empty list removes that scope's recipe.
    await setPackagingRecipe(prisma, { merchantId: f.merchant.id, lines: [], actorUserId: admin });
    expect(await recipeFor(prisma, f.store.id, f.merchant.id)).toEqual([
      { itemId: bag.id, quantity: 2 },
    ]);
  });

  it('lowers packaging stock when an order is packed and books its cost with the order', async () => {
    const bag = await item('BAG');
    const box = await item('BOX-S', true);
    await buy(bag.id, 3, 1_000); // 333.33 piastres each: the last unit takes what is left
    await buy(box.id, 10, 5_000);
    await setPackagingRecipe(prisma, {
      lines: [{ itemId: bag.id, quantity: 1 }],
      actorUserId: admin,
    });
    const o = await pickedOrder();
    const result = await packOrder(prisma, {
      orderId: o.id,
      darkStoreId: f.store.id,
      photoId: await packPhoto(),
      boxItemId: box.id,
      actorUserId: admin,
    });
    expect(result).toEqual({ costPiastres: 333 + 500, short: [] });
    expect(await onHand(bag.id)).toBe(2);
    expect(await onHand(box.id)).toBe(9);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { kind: 'packaging_used' },
      include: { lines: true },
    });
    expect(entry.orderId).toBe(o.id);
    for (const line of entry.lines)
      expect(line).toMatchObject({ darkStoreId: f.store.id, merchantId: f.merchant.id });
    expect(await balance('expense:packaging')).toBe(833);
    expect((await packagingForOrder(prisma, o.id)).costPiastres).toBe(833);
    // Stock value always equals what is left on the levels.
    const levels = await prisma.packagingLevel.aggregate({ _sum: { valuePiastres: true } });
    expect(await balance('packaging_stock')).toBe(levels._sum.valuePiastres);
  });

  it('never blocks packing: what is missing is recorded as short, stock never goes below zero', async () => {
    const bag = await item('BAG');
    await buy(bag.id, 1, 200);
    await setPackagingRecipe(prisma, {
      lines: [{ itemId: bag.id, quantity: 3 }],
      actorUserId: admin,
    });
    const o = await pickedOrder();
    const result = await packOrder(prisma, {
      orderId: o.id,
      darkStoreId: f.store.id,
      photoId: await packPhoto(),
      actorUserId: admin,
    });
    expect(result.short).toEqual([{ itemId: bag.id, quantity: 2 }]);
    expect(await onHand(bag.id)).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('packed');
    expect(await prisma.alert.count({ where: { type: 'packaging_short', orderId: o.id } })).toBe(1);
    // The database refuses a negative level even if code tried.
    await expect(
      prisma.packagingLevel.updateMany({ where: { itemId: bag.id }, data: { onHand: -1 } }),
    ).rejects.toThrow();
  });

  it('raises one low alert per store and item while it stays low', async () => {
    await setSetting(prisma, {
      key: 'stock.packaging_low_units',
      scope: f.store.id,
      value: 5,
      actorUserId: admin,
    });
    const bag = await item('BAG');
    await buy(bag.id, 7, 700);
    const use = (quantity: number) =>
      adjustPackaging(prisma, {
        darkStoreId: f.store.id,
        itemId: bag.id,
        quantity: -quantity,
        reason: 'torn',
        actorUserId: admin,
        idempotencyKey: key(),
      });
    await use(1);
    expect(await prisma.alert.count({ where: { type: 'packaging_low' } })).toBe(0);
    await use(1);
    await use(1);
    expect(await prisma.alert.count({ where: { type: 'packaging_low' } })).toBe(1);
  });

  it('adjusts and counts at average cost, with a reason, and keeps movements append only', async () => {
    const bag = await item('BAG');
    await buy(bag.id, 10, 1_000);
    await expect(
      adjustPackaging(prisma, {
        darkStoreId: f.store.id,
        itemId: bag.id,
        quantity: -11,
        reason: 'lost',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('packaging_not_enough');
    const k = key();
    const lost = () =>
      adjustPackaging(prisma, {
        darkStoreId: f.store.id,
        itemId: bag.id,
        quantity: -2,
        reason: 'wet',
        actorUserId: admin,
        idempotencyKey: k,
      });
    await lost();
    await lost(); // a retry changes nothing
    expect(await onHand(bag.id)).toBe(8);
    expect(await balance('expense:packaging')).toBe(200);
    expect(
      await countPackaging(prisma, {
        darkStoreId: f.store.id,
        itemId: bag.id,
        counted: 9,
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).toEqual({ difference: 1 });
    // A found unit comes in at the item's unit cost (100).
    expect(await balance('packaging_stock')).toBe(900);
    const movement = await prisma.packagingMovement.findFirstOrThrow();
    await expect(
      prisma.packagingMovement.update({ where: { id: movement.id }, data: { quantity: 99 } }),
    ).rejects.toThrow();
    await expect(prisma.packagingMovement.delete({ where: { id: movement.id } })).rejects.toThrow();
  });

  it('runs the consumption once per order', async () => {
    const bag = await item('BAG');
    await buy(bag.id, 5, 500);
    await setPackagingRecipe(prisma, {
      lines: [{ itemId: bag.id, quantity: 1 }],
      actorUserId: admin,
    });
    const o = await pickedOrder();
    await packOrder(prisma, {
      orderId: o.id,
      darkStoreId: f.store.id,
      photoId: await packPhoto(),
      actorUserId: admin,
    });
    await expect(
      packOrder(prisma, {
        orderId: o.id,
        darkStoreId: f.store.id,
        photoId: await packPhoto(),
        actorUserId: admin,
      }),
    ).rejects.toThrow();
    await expect(
      prisma.$transaction((tx) =>
        consumePackagingForOrder(tx, {
          orderId: o.id,
          orderNumber: 'x',
          darkStoreId: f.store.id,
          merchantId: f.merchant.id,
          actorUserId: admin,
        }),
      ),
    ).rejects.toThrow();
    expect(await onHand(bag.id)).toBe(4);
  });
});

describe('purchase orders', () => {
  async function supplier() {
    return createSupplier(prisma, {
      name: 'Cairo Packaging Co',
      whtBp: 100,
      actorUserId: admin,
    });
  }

  it('approves at once below the limit and waits for another person from it', async () => {
    const s = await supplier();
    const rent = await byKey('expense:other');
    const small = await requestPurchaseOrder(prisma, {
      supplierId: s.id,
      lines: [
        { expenseAccountId: rent.id, description: 'Pens', quantity: 10, unitPricePiastres: 500 },
      ],
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(small).toMatchObject({ number: 1, status: 'approved' });
    const big = await requestPurchaseOrder(prisma, {
      supplierId: s.id,
      lines: [
        {
          expenseAccountId: rent.id,
          description: 'Shelves',
          quantity: 1,
          unitPricePiastres: 2_000_000,
        },
      ],
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(big).toMatchObject({ number: 2, status: 'requested' });
    await expect(
      markPurchaseOrdered(prisma, { purchaseOrderId: big.id, actorUserId: admin }),
    ).rejects.toThrow('purchase_order_not_approved');
    await expect(
      decidePurchaseOrder(prisma, { purchaseOrderId: big.id, approve: true, actorUserId: admin }),
    ).rejects.toThrow('same_person');
    await expect(
      decidePurchaseOrder(prisma, {
        purchaseOrderId: big.id,
        approve: false,
        actorUserId: approver,
      }),
    ).rejects.toThrow('note_required');
    expect(
      await decidePurchaseOrder(prisma, {
        purchaseOrderId: big.id,
        approve: true,
        actorUserId: approver,
      }),
    ).toEqual({ status: 'approved' });
    // Packaging needs the store it goes into.
    const bag = await item('BAG');
    await expect(
      requestPurchaseOrder(prisma, {
        supplierId: s.id,
        lines: [
          { packagingItemId: bag.id, description: 'Bags', quantity: 1, unitPricePiastres: 100 },
        ],
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('store_required');
  });

  it('receives in parts into packaging stock, bills from the order within the tolerance and closes', async () => {
    const s = await supplier();
    const bag = await item('BAG');
    const box = await item('BOX', true);
    const k = key();
    const ask = () =>
      requestPurchaseOrder(prisma, {
        supplierId: s.id,
        darkStoreId: f.store.id,
        lines: [
          { packagingItemId: bag.id, description: 'Bags', quantity: 1000, unitPricePiastres: 50 },
          { packagingItemId: box.id, description: 'Boxes', quantity: 100, unitPricePiastres: 400 },
        ],
        actorUserId: admin,
        idempotencyKey: k,
      });
    const po = await ask();
    expect((await ask()).id).toBe(po.id); // a retry asks once
    await markPurchaseOrdered(prisma, { purchaseOrderId: po.id, actorUserId: admin });
    let full = await getPurchaseOrder(prisma, po.id);
    const [bagLine, boxLine] = full.lines;
    const rk = key();
    const firstDelivery = () =>
      receivePurchaseOrder(prisma, {
        purchaseOrderId: po.id,
        lines: [{ lineId: bagLine!.id, quantity: 600 }],
        actorUserId: admin,
        idempotencyKey: rk,
      });
    expect(await firstDelivery()).toEqual({ replayed: false, status: 'ordered' });
    expect(await firstDelivery()).toMatchObject({ replayed: true });
    expect(await onHand(bag.id)).toBe(600);
    expect(await balance('packaging_stock')).toBe(30_000);
    expect(await balance('goods_received')).toBe(-30_000);
    await expect(
      receivePurchaseOrder(prisma, {
        purchaseOrderId: po.id,
        lines: [{ lineId: bagLine!.id, quantity: 401 }],
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('more_than_ordered');

    // Bill what came so far: ordered price 300.00, tolerance 2% → at most 306.00.
    const billInput = (net: number) => ({
      purchaseOrderId: po.id,
      reference: `INV-${net}`,
      billDate: cairoDay(new Date()),
      dueDate: cairoDay(new Date()),
      netPiastres: net,
      vatPiastres: 0,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await expect(billPurchaseOrder(prisma, billInput(30_700))).rejects.toThrow('bill_above_order');
    const first = await billPurchaseOrder(prisma, billInput(30_500));
    expect(first).toMatchObject({ totalPiastres: 30_500, purchaseOrderId: po.id });
    expect(await balance('goods_received')).toBe(0);
    expect(await balance('expense:packaging')).toBe(500); // the price difference
    await expect(billPurchaseOrder(prisma, billInput(100))).rejects.toThrow('nothing_to_bill');
    await expect(
      cancelBill(prisma, { billId: first.id, reason: 'mistake here', actorUserId: admin }),
    ).rejects.toThrow('bill_from_purchase_order');

    await receivePurchaseOrder(prisma, {
      purchaseOrderId: po.id,
      lines: [
        { lineId: bagLine!.id, quantity: 400 },
        { lineId: boxLine!.id, quantity: 100 },
      ],
      actorUserId: admin,
      idempotencyKey: key(),
    });
    full = await getPurchaseOrder(prisma, po.id);
    expect(full.status).toBe('received');
    expect(full.unbilledPiastres).toBe(20_000 + 40_000);
    await expect(
      closePurchaseOrder(prisma, { purchaseOrderId: po.id, note: 'done', actorUserId: admin }),
    ).rejects.toThrow('unbilled_receipts');
    const second = await billPurchaseOrder(prisma, billInput(59_000));
    expect((await getPurchaseOrder(prisma, po.id)).status).toBe('billed');
    expect(await balance('goods_received')).toBe(0);
    expect(await balance('expense:packaging')).toBe(500 - 1_000);
    // Paid like any bill, withholding tax kept back.
    await payBill(prisma, {
      billId: second.id,
      amountPiastres: 59_000,
      moneyAccountId: (await byKey('bank')).id,
      reference: 'TRX-1',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(
      await closePurchaseOrder(prisma, {
        purchaseOrderId: po.id,
        note: 'done',
        actorUserId: admin,
      }),
    ).toEqual({ status: 'closed' });
  });

  it('cancels an order nothing arrived for', async () => {
    const s = await supplier();
    const other = await byKey('expense:other');
    const po = await requestPurchaseOrder(prisma, {
      supplierId: s.id,
      lines: [
        { expenseAccountId: other.id, description: 'Fan', quantity: 1, unitPricePiastres: 1 },
      ],
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(
      await closePurchaseOrder(prisma, {
        purchaseOrderId: po.id,
        note: 'not needed',
        actorUserId: admin,
      }),
    ).toEqual({ status: 'cancelled' });
  });
});

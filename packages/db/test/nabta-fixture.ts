import type { PrismaClient } from '@prisma/client';
import { createMerchant, createSku, createUser } from '../src/admin-ops';
import { receive } from '../src/stock';
import { createOrder } from '../src/orders';
import { post } from '../src/finance';

/**
 * A merchant like the live Nabta: a user, one product, a Shopify store (custom app, one
 * location, data syncs), Shopify products, customers and orders, a fee of its own, some stock
 * and an order with its wallet entry. Used by the fresh start test and a manual run.
 */
export async function createNabta(prisma: PrismaClient, adminId: string, password: string) {
  const store = await prisma.darkStore.findFirstOrThrow({
    where: { kind: 'dark_store' },
    orderBy: { code: 'asc' },
  });
  const receiving = await prisma.bin.findFirstOrThrow({
    where: { darkStoreId: store.id, type: 'receiving' },
  });
  const merchant = await createMerchant(prisma, {
    name: 'Nabta',
    contactEmail: 'hello@getnabta.example',
    actorUserId: adminId,
  });
  const user = await createUser(prisma, {
    email: 'owner@getnabta.example',
    name: 'Nabta Owner',
    role: 'merchant',
    password,
    merchantId: merchant.id,
    actorUserId: adminId,
  });
  const sku = await createSku(prisma, {
    merchantId: merchant.id,
    sku: 'NAB-001',
    barcode: '6229999000017',
    titleEn: 'Nabta plant pot',
    titleAr: 'أصيص نبتة',
    pricePiastres: 25_000,
    actorUserId: adminId,
  });
  await prisma.sku.update({
    where: { id: sku.id },
    data: {
      shopifyVariantId: 'gid://shopify/ProductVariant/9001',
      shopifyInventoryItemId: 'gid://shopify/InventoryItem/9001',
    },
  });

  const app = await prisma.shopifyApp.create({
    data: { name: 'Nabta app', clientId: 'nabta-client-id', clientSecretEnc: 'sealed' },
  });
  const shop = await prisma.shopifyShop.create({
    data: {
      merchantId: merchant.id,
      appId: app.id,
      shopDomain: 'getnabta.myshopify.com',
      status: 'active',
      accessTokenEnc: 'sealed',
      installedAt: new Date(),
      carrierServiceId: 'gid://shopify/DeliveryCarrierService/1',
    },
  });
  const location = await prisma.shopifyLocation.create({
    data: {
      shopId: shop.id,
      darkStoreId: store.id,
      fulfillmentServiceId: 'gid://shopify/FulfillmentService/1',
      locationId: 'gid://shopify/Location/1',
    },
  });
  await prisma.shopifyStockSync.create({
    data: { locationId: location.id, skuId: sku.id, activated: true, lastPushedQty: 4 },
  });
  for (const kind of ['products', 'orders', 'customers']) {
    await prisma.shopDataSync.create({ data: { shopId: shop.id, kind, status: 'done' } });
  }
  await prisma.shopProduct.create({
    data: {
      shopId: shop.id,
      merchantId: merchant.id,
      shopifyId: 'gid://shopify/Product/900',
      title: 'Nabta plant pot',
      status: 'ACTIVE',
      raw: {},
    },
  });
  await prisma.shopVariant.create({
    data: {
      shopId: shop.id,
      productShopifyId: 'gid://shopify/Product/900',
      shopifyId: 'gid://shopify/ProductVariant/9001',
      title: 'Default',
      raw: {},
    },
  });
  await prisma.shopInventoryLevel.create({
    data: {
      shopId: shop.id,
      inventoryItemId: 'gid://shopify/InventoryItem/9001',
      locationId: 'gid://shopify/Location/99',
      locationName: 'Nabta warehouse',
    },
  });
  const now = new Date();
  for (const [i, phone] of ['+201000009001', '+201000009002'].entries()) {
    const customer = await prisma.customer.create({
      data: { phone, name: `Nabta buyer ${i + 1}`, firstSeenAt: now, lastSeenAt: now },
    });
    await prisma.customerAlias.create({
      data: { customerId: customer.id, kind: 'email', value: `buyer${i + 1}@getnabta.example` },
    });
    await prisma.shopCustomer.create({
      data: {
        shopId: shop.id,
        merchantId: merchant.id,
        shopifyId: `gid://shopify/Customer/${i + 1}`,
        customerId: customer.id,
        raw: {},
      },
    });
    await prisma.shopOrder.create({
      data: {
        shopId: shop.id,
        merchantId: merchant.id,
        shopifyId: `gid://shopify/Order/${i + 1}`,
        name: `#100${i + 1}`,
        createdAtShop: now,
        currency: 'EGP',
        customerId: customer.id,
        raw: {},
      },
    });
  }
  await prisma.setting.create({
    data: { key: 'fee.order_fixed_piastres', scope: `merchant:${merchant.id}`, value: 1200 },
  });

  // Activity that the fresh start wipes: stock, an order and a wallet entry.
  await receive(prisma, {
    skuId: sku.id,
    binId: receiving.id,
    quantity: 6,
    actorUserId: adminId,
    reason: 'opening_stock',
    idempotencyKey: 'nabta:receive',
  });
  const shelf = await prisma.bin.findFirstOrThrow({
    where: { darkStoreId: store.id, type: 'pickable' },
    orderBy: { code: 'asc' },
  });
  const { move } = await import('../src/stock');
  await move(prisma, {
    skuId: sku.id,
    fromBinId: receiving.id,
    toBinId: shelf.id,
    quantity: 6,
    actorUserId: adminId,
    reason: 'put_away',
    idempotencyKey: 'nabta:putaway',
  });
  await createOrder(prisma, {
    merchantId: merchant.id,
    darkStoreId: store.id,
    source: 'manual',
    customerName: 'Nabta buyer 1',
    customerPhone: '01000009001',
    addressText: 'Street 9, New Cairo',
    paymentMethod: 'cod',
    deliveryFeePiastres: 3000,
    items: [{ skuId: sku.id, quantity: 2 }],
    actorUserId: adminId,
  });
  await post(prisma, {
    kind: 'merchant_adjustment',
    idempotencyKey: 'nabta:wallet',
    memo: 'test',
    lines: [
      { account: { type: 'merchant', merchantId: merchant.id }, amount: -500 },
      { account: { type: 'revenue' }, amount: 500 },
    ],
  });
  return { merchant, user, sku, shop, store };
}

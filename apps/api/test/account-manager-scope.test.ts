import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

const PASSWORD = 'manager-password-1';

/**
 * Account managers (own_merchants_only) reach only their own merchants in the older Shopify,
 * market data and customer endpoints too.
 */
describe('account managers in the Shopify, data and customer screens', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let am: ReturnType<typeof request.agent>;
  let mine: { merchantId: string; shopId: string; customerId: string };
  let other: { merchantId: string; shopId: string; customerId: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  /** A merchant with a Shopify store (not connected yet) and one customer who bought there. */
  const merchantWithShop = async (name: string, domain: string, n: number) => {
    const merchant = await prisma.merchant.create({ data: { name } });
    const shop = await prisma.shopifyShop.create({
      data: { merchantId: merchant.id, shopDomain: `${domain}.myshopify.com` },
    });
    const customer = await prisma.customer.create({
      data: {
        name: `${name} buyer`,
        phone: `+2010000000${n}0`,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    await prisma.shopOrder.create({
      data: {
        shopId: shop.id,
        merchantId: merchant.id,
        customerId: customer.id,
        shopifyId: `gid://shopify/Order/${n}`,
        name: `#${n}`,
        createdAtShop: new Date(),
        currency: 'EGP',
        tags: [],
        raw: {},
      },
    });
    return { merchantId: merchant.id, shopId: shop.id, customerId: customer.id };
  };

  beforeEach(async () => {
    await resetAndSeed(prisma);
    const user = await createUser(prisma, { email: 'am@t.eg', password: PASSWORD, role: 'admin' });
    await grantAccess(prisma, user.id, 'account_manager');
    // This account manager also has the customer data switch, to reach the named screens.
    await prisma.userAccess.update({ where: { userId: user.id }, data: { customerData: true } });
    mine = await merchantWithShop('Mine', 'mine-store', 1);
    other = await merchantWithShop('Other', 'other-store', 2);
    await prisma.merchant.update({
      where: { id: mine.merchantId },
      data: { accountManagerId: user.id },
    });
    am = request.agent(app.getHttpServer());
    await am.post('/auth/login').send({ email: 'am@t.eg', password: PASSWORD }).expect(200);
  });

  it('lists and acts only on their merchants Shopify stores', async () => {
    const overview = (await am.get('/admin/shopify').expect(200)).body;
    expect(overview.shops.map((s: { id: string }) => s.id)).toEqual([mine.shopId]);
    for (const path of ['sync-now', 'sync-catalog']) {
      const refused = await am.post(`/admin/shopify/${other.shopId}/${path}`).send({}).expect(403);
      expect(refused.body.error).toBe('merchant_not_allowed');
    }
    // Their own store passes the scope (and then meets its own rule: not installed yet).
    const own = await am.post(`/admin/shopify/${mine.shopId}/sync-now`).expect(409);
    expect(own.body.error).toBe('shop_not_installed');
    // The owner still sees every store.
    const owner = request.agent(app.getHttpServer());
    await owner
      .post('/auth/login')
      .send({ email: 'admin@test.eg', password: 'admin-password-1' })
      .expect(200);
    expect((await owner.get('/admin/shopify').expect(200)).body.shops.length).toBe(2);
  });

  it('shows market data by name only for their merchants', async () => {
    const market = (await am.get('/admin/data/market').expect(200)).body;
    const names = market.merchants.map((m: { id: string }) => m.id);
    expect(names).toContain(mine.merchantId);
    expect(names).not.toContain(other.merchantId);
    expect(
      market.orderHistory.every((h: { merchantId: string }) => h.merchantId === mine.merchantId),
    ).toBe(true);
    await am.get(`/admin/data/merchants/${mine.merchantId}`).expect(200);
    const refused = await am.get(`/admin/data/merchants/${other.merchantId}`).expect(403);
    expect(refused.body.error).toBe('merchant_not_allowed');
    await am.post(`/admin/data/merchants/${other.merchantId}/refresh`).expect(403);
  });

  it('reaches only customers who bought from their merchants', async () => {
    const list = (await am.get('/admin/customers').expect(200)).body;
    const ids = (list.rows ?? list.customers ?? list).map((c: { id: string }) => c.id);
    expect(ids).toEqual([mine.customerId]);
    await am.get(`/admin/customers/${mine.customerId}`).expect(200);
    const refused = await am.get(`/admin/customers/${other.customerId}`).expect(403);
    expect(refused.body.error).toBe('merchant_not_allowed');
    const csv = (await am.get('/admin/customers/export').expect(200)).text;
    expect(csv).toContain('Mine buyer');
    expect(csv).not.toContain('Other buyer');
    await am.get(`/admin/customers?merchantId=${other.merchantId}`).expect(403);
    const overview = (await am.get('/admin/customers/overview').expect(200)).body;
    expect(
      overview.orderHistory.every((h: { merchantId: string }) => h.merchantId === mine.merchantId),
    ).toBe(true);
  });
});

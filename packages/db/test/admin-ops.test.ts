import { skuImportRowSchema } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  changeSetting,
  createMerchant,
  createSku,
  createUser,
  importSkus,
  listAudit,
  listSettings,
  resetUserPassword,
  updateSku,
  updateUser,
} from '../src/admin-ops';
import { computeKpis } from '../src/kpis';
import {
  acceptOrder,
  completeDelivery,
  createOrder,
  handToRider,
  packOrder,
  pickOrderItem,
} from '../src/orders';
import { verifyPassword } from '../src/password';
import { savePhoto } from '../src/photos';
import { getSetting } from '../src/settings';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
});

afterAll(() => prisma.$disconnect());

const base = { password: 'long-password-1', actorUserId: '' };

describe('users', () => {
  it('needs the right link for each role', async () => {
    await expect(
      createUser(prisma, {
        ...base,
        actorUserId: admin,
        email: 's@t.eg',
        name: 'Staff',
        role: 'store_staff',
      }),
    ).rejects.toMatchObject({ code: 'dark_store_required' });
    await expect(
      createUser(prisma, {
        ...base,
        actorUserId: admin,
        email: 'r@t.eg',
        name: 'Rider',
        role: 'rider',
        darkStoreId: f.store.id,
      }),
    ).rejects.toMatchObject({ code: 'badge_required' });
    await expect(
      createUser(prisma, {
        ...base,
        actorUserId: admin,
        email: 'm@t.eg',
        name: 'Merch',
        role: 'merchant',
      }),
    ).rejects.toMatchObject({ code: 'merchant_required' });
  });

  it('creates a rider with a badge and audits it without the password', async () => {
    const user = await createUser(prisma, {
      ...base,
      actorUserId: admin,
      email: 'r@t.eg',
      name: 'Rider',
      role: 'rider',
      phone: '+201012345678',
      darkStoreId: f.store.id,
      badgeCode: 'RDR-9',
    });
    const rider = await prisma.rider.findUnique({ where: { userId: user.id } });
    expect(rider).toMatchObject({ badgeCode: 'RDR-9', darkStoreId: f.store.id });
    expect(await verifyPassword(user.passwordHash, 'long-password-1')).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: user.id } });
    expect(JSON.stringify(audit)).not.toContain('passwordHash');
    expect(audit?.after).toMatchObject({ role: 'rider', badgeCode: 'RDR-9' });

    await expect(
      createUser(prisma, {
        ...base,
        actorUserId: admin,
        email: 'r2@t.eg',
        name: 'Rider 2',
        role: 'rider',
        darkStoreId: f.store.id,
        badgeCode: 'RDR-9',
      }),
    ).rejects.toMatchObject({ code: 'badge_taken' });
    await expect(
      createUser(prisma, {
        ...base,
        actorUserId: admin,
        email: 'r@t.eg',
        name: 'Again',
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('signs a user out everywhere when deactivated or the password is reset', async () => {
    const user = await createUser(prisma, {
      ...base,
      actorUserId: admin,
      email: 's@t.eg',
      name: 'Staff',
      role: 'store_staff',
      darkStoreId: f.store.id,
    });
    const token = () =>
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: `h-${Math.random()}`,
          expiresAt: new Date(Date.now() + 1e9),
        },
      });
    await token();
    await updateUser(prisma, { userId: user.id, isActive: false, actorUserId: admin });
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );

    await token();
    await resetUserPassword(prisma, {
      userId: user.id,
      password: 'new-password-22',
      actorUserId: admin,
    });
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(fresh.passwordHash, 'new-password-22')).toBe(true);

    await expect(
      updateUser(prisma, { userId: admin, isActive: false, actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'cannot_deactivate_self' });
  });
});

describe('products', () => {
  it('keeps barcodes unique across merchants', async () => {
    const other = await createMerchant(prisma, { name: 'Other', actorUserId: admin });
    await createSku(prisma, {
      merchantId: f.merchant.id,
      sku: 'NEW-1',
      barcode: '622000',
      titleEn: 'New',
      titleAr: 'جديد',
      pricePiastres: 5000,
      actorUserId: admin,
    });
    await expect(
      createSku(prisma, {
        merchantId: other.id,
        sku: 'X-1',
        barcode: '622000',
        titleEn: 'X',
        titleAr: 'X',
        pricePiastres: 1,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'barcode_taken' });
    await expect(
      createSku(prisma, {
        merchantId: f.merchant.id,
        sku: 'NEW-1',
        titleEn: 'Dup',
        titleAr: 'Dup',
        pricePiastres: 1,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'sku_taken' });
  });

  it('imports a file all or nothing and reports what changed', async () => {
    const parse = (r: Record<string, unknown>) => skuImportRowSchema.parse(r);
    expect(parse({ sku: 'A', title_en: 'Bra', price_egp: '1,299.5' }).pricePiastres).toBe(129950);
    expect(parse({ sku: 'A', title_en: 'Bra', price_egp: '10' }).titleAr).toBe('Bra');
    expect(() => parse({ sku: 'A', title_en: 'Bra', price_egp: '10.555' })).toThrow();

    const bad = await importSkus(prisma, {
      merchantId: f.merchant.id,
      actorUserId: admin,
      rows: [
        { row: 2, data: parse({ sku: 'N-1', title_en: 'One', price_egp: 10 }) },
        { row: 3, data: parse({ sku: 'N-1', title_en: 'Again', price_egp: 10 }) },
      ],
    });
    expect(bad.errors).toEqual([{ row: 3, sku: 'N-1', error: 'duplicate_sku_in_file' }]);
    expect(await prisma.sku.count({ where: { sku: 'N-1' } })).toBe(0);

    const ok = await importSkus(prisma, {
      merchantId: f.merchant.id,
      actorUserId: admin,
      rows: [
        {
          row: 2,
          data: parse({
            sku: 'N-1',
            title_en: 'One',
            title_ar: 'واحد',
            price_egp: 10,
            barcode: '111',
          }),
        },
        {
          row: 3,
          data: parse({ sku: 'SKU-1', title_en: 'SKU-1', title_ar: 'SKU-1', price_egp: '10' }),
        },
        { row: 4, data: parse({ sku: 'SKU-2', title_en: 'Renamed', price_egp: '12' }) },
      ],
    });
    expect(ok).toEqual({ created: 1, updated: 1, unchanged: 1, errors: [] });
    expect(await prisma.sku.findFirst({ where: { sku: 'SKU-2' } })).toMatchObject({
      titleEn: 'Renamed',
      pricePiastres: 1200,
    });
  });

  it('updates a product with before and after in the audit', async () => {
    await updateSku(prisma, { skuId: f.sku.id, pricePiastres: 2500, actorUserId: admin });
    const audit = await listAudit(prisma, { entityType: 'sku', entityId: f.sku.id });
    expect(audit.rows[0]).toMatchObject({
      action: 'sku.update',
      before: { pricePiastres: 1000 },
      after: { pricePiastres: 2500 },
      actor: { name: 'Admin' },
    });
  });
});

describe('settings', () => {
  it('sets global values and store overrides, and removes overrides', async () => {
    await changeSetting(prisma, {
      key: 'sla.pick_minutes',
      scope: 'global',
      value: 12,
      actorUserId: admin,
    });
    await changeSetting(prisma, {
      key: 'sla.pick_minutes',
      scope: f.store.id,
      value: 8,
      actorUserId: admin,
    });
    expect(await getSetting(prisma, 'sla.pick_minutes', f.store.id)).toBe(8);
    expect(await getSetting(prisma, 'sla.pick_minutes', f.other.id)).toBe(12);

    const list = await listSettings(prisma);
    expect(list.settings.find((s) => s.key === 'sla.pick_minutes')).toMatchObject({
      default: 10,
      global: 12,
      overrides: [{ darkStoreId: f.store.id, value: 8 }],
    });

    await changeSetting(prisma, {
      key: 'sla.pick_minutes',
      scope: f.store.id,
      value: null,
      actorUserId: admin,
    });
    expect(await getSetting(prisma, 'sla.pick_minutes', f.store.id)).toBe(12);
    await expect(
      changeSetting(prisma, {
        key: 'delivery.max_orders_per_trip',
        scope: 'global',
        value: 9,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'invalid_setting_value' });
    await expect(
      changeSetting(prisma, {
        key: 'sla.pick_minutes',
        scope: 'global',
        value: null,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'global_value_required' });
  });
});

describe('audit paging', () => {
  it('pages newest first with a cursor', async () => {
    for (let i = 0; i < 5; i++)
      await updateSku(prisma, { skuId: f.sku.id, pricePiastres: 100 + i, actorUserId: admin });
    const first = await listAudit(prisma, { entityType: 'sku', take: 3 });
    expect(first.rows).toHaveLength(3);
    expect(first.rows[0]!.after).toMatchObject({ pricePiastres: 104 });
    const second = await listAudit(prisma, {
      entityType: 'sku',
      take: 3,
      cursor: first.nextCursor!,
    });
    expect(second.rows).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
});

describe('kpis', () => {
  it('counts delivered, on time, stage times and cash', async () => {
    await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 10 });
    const riderUser = await createUser(prisma, {
      ...base,
      actorUserId: admin,
      email: 'r@t.eg',
      name: 'Rider',
      role: 'rider',
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
    });
    const t0 = new Date('2026-03-01T10:00:00Z');
    const order = await createOrder(prisma, {
      merchantId: f.merchant.id,
      darkStoreId: f.store.id,
      source: 'manual',
      customerName: 'C',
      customerPhone: '01012345678',
      addressText: 'Somewhere',
      paymentMethod: 'cod',
      deliveryFeePiastres: 3000,
      items: [{ skuId: f.sku.id, quantity: 2 }],
      actorUserId: admin,
    });
    const at = (m: number) => new Date(t0.getTime() + m * 60_000);
    const ids = { orderId: order.id, darkStoreId: f.store.id, actorUserId: admin };
    await acceptOrder(prisma, ids);
    await pickOrderItem(prisma, {
      ...ids,
      skuId: f.sku.id,
      quantity: 2,
      idempotencyKey: 'kpi-pick-1',
    });
    const photo = await savePhoto(prisma, {
      kind: 'pack',
      contentType: 'image/jpeg',
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      actorUserId: admin,
    });
    await packOrder(prisma, { ...ids, photoId: photo.id });
    const { delivery } = await handToRider(prisma, { ...ids, badgeCode: 'RDR-1' }).then(
      async () => ({
        delivery: await prisma.delivery.findFirstOrThrow({ where: { orderId: order.id } }),
      }),
    );
    const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    await completeDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId: riderUser.id,
      otp: full.deliveryOtp,
      codCollectedPiastres: full.codAmountPiastres,
    });

    // Put the stage times on a known timeline: accept 1, pick 6, pack 3, hand over 2, ride 20.
    await prisma.order.update({
      where: { id: order.id },
      data: {
        placedAt: t0,
        acceptedAt: at(1),
        pickedAt: at(7),
        packedAt: at(10),
        outForDeliveryAt: at(12),
        deliveredAt: at(32),
        slaDueAt: at(60),
      },
    });
    const kpis = await computeKpis(prisma, {
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2099-01-01T00:00:00Z'),
    });
    expect(kpis.totals).toMatchObject({
      orders: 1,
      delivered: 1,
      unitsDelivered: 2,
      deliveredValuePiastres: 2000,
      deliveryFeesPiastres: 3000,
      codCollectedPiastres: 5000,
      codExpectedPiastres: 5000,
    });
    expect(kpis.totals.stageAvgMinutes).toEqual({
      accept: 1,
      pick: 6,
      pack: 3,
      handover: 2,
      ride: 20,
    });
    expect(kpis.totals).toMatchObject({ onTime: 1, onTimeRate: 1, avgDeliveryMinutes: 32 });
    expect(kpis.byStatus).toEqual({ delivered: 1 });
    expect(kpis.perStore).toHaveLength(1);
    expect(kpis.perDay).toEqual([{ date: '2026-03-01', orders: 1, delivered: 1, onTime: 1 }]);
  });
});

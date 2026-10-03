/* Idempotent seed: reference data, config defaults, hubs, merchants, users and demo orders. */
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { GOVERNORATES, OrderStatus, PRICING_ZONES } from '@shiply/shared';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { RequestContext } from '../src/common/context';
import { CONFIG_DEFAULTS } from '../src/config/defaults';
import { FinanceService } from '../src/accounting/finance.service';
import { CashoutService } from '../src/accounting/cashout.service';
import { SettlementService } from '../src/accounting/settlement.service';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  AREAS, CHART_OF_ACCOUNTS, DEMO_ORDERS, DEMO_PASSWORD, HUBS, MERCHANTS, SIZE_ADD, STAFF, TIER_BP, ZONE_LEVEL, ZONE_LEVEL_STEP,
} from './seed-data';

export async function seed(opts: { demoOrders?: boolean; log?: boolean } = {}) {
  const log = opts.log === false ? () => undefined : console.log;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const orders = app.get(OrdersService);
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await prisma.asSystem(async (tx) => {
    for (const c of CONFIG_DEFAULTS) {
      await tx.systemConfig.upsert({
        where: { key: c.key },
        // Keep values an admin already edited; only refresh the documented default.
        update: { defaultValue: c.value as Prisma.InputJsonValue, description: c.description, category: c.category, valueType: c.type },
        create: {
          key: c.key,
          value: c.value as Prisma.InputJsonValue,
          defaultValue: c.value as Prisma.InputJsonValue,
          valueType: c.type,
          category: c.category,
          description: c.description,
        },
      });
    }
    log(`config: ${CONFIG_DEFAULTS.length} keys`);

    for (const a of CHART_OF_ACCOUNTS) {
      await tx.ledgerAccount.upsert({
        where: { code: a.code },
        update: { nameEn: a.en, nameAr: a.ar, description: a.d },
        create: { code: a.code, nameEn: a.en, nameAr: a.ar, type: a.type, description: a.d },
      });
    }
    log(`chart of accounts: ${CHART_OF_ACCOUNTS.length} accounts`);

    for (const g of GOVERNORATES) {
      await tx.governorate.upsert({
        where: { code: g.code },
        update: {},
        create: { code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, pricingZone: g.defaultZone, lat: g.lat, lng: g.lng },
      });
    }
    if ((await tx.area.count()) === 0) {
      await tx.area.createMany({
        data: AREAS.map((a) => ({
          governorateCode: a.gov, nameEn: a.en, nameAr: a.ar, lat: a.lat, lng: a.lng,
          keywords: a.keywords ?? [], pricingZone: a.zone ?? null,
        })),
      });
    }
    log(`geo: ${GOVERNORATES.length} governorates, ${AREAS.length} areas`);

    for (const h of HUBS) {
      await tx.hub.upsert({
        where: { code: h.code },
        update: {},
        create: {
          code: h.code, nameEn: h.nameEn, nameAr: h.nameAr, governorateCode: h.gov, addressLine: h.address,
          lat: h.lat, lng: h.lng, receivesPickups: h.receivesPickups, dispatchesLastMile: h.dispatchesLastMile,
        },
      });
    }
    log(`hubs: ${HUBS.length}`);

    const base = CONFIG_DEFAULTS.find((c) => c.key === 'pricing.base_price_cairo_giza')!.value as number;
    for (const a of PRICING_ZONES) {
      for (const b of PRICING_ZONES) {
        await tx.pricingZonePrice.upsert({
          where: { pickupZone_destZone: { pickupZone: a, destZone: b } },
          update: {},
          create: { pickupZone: a, destZone: b, basePricePiastres: base + ZONE_LEVEL_STEP * Math.max(ZONE_LEVEL[a], ZONE_LEVEL[b]) },
        });
      }
    }
    for (const [size, add] of Object.entries(SIZE_ADD)) {
      await tx.pricingSizeAdjustment.upsert({ where: { size: size as never }, update: {}, create: { size: size as never, addPiastres: add } });
    }
    for (const [tier, bp] of Object.entries(TIER_BP)) {
      await tx.pricingTierAdjustment.upsert({ where: { tier: tier as never }, update: {}, create: { tier: tier as never, multiplierBp: bp } });
    }
    log('pricing tables ready');

    for (const s of STAFF) {
      const hub = 'hub' in s && s.hub ? await tx.hub.findUnique({ where: { code: s.hub } }) : null;
      await tx.user.upsert({
        where: { email: s.email },
        update: {},
        create: { email: s.email, fullName: s.name, role: s.role, passwordHash: hash, hubId: hub?.id ?? null },
      });
    }

    for (const m of MERCHANTS) {
      const merchant = await tx.merchant.upsert({
        where: { code: m.code },
        update: {},
        create: { code: m.code, nameEn: m.nameEn, nameAr: m.nameAr, tier: m.tier },
      });
      if ((await tx.pickupLocation.count({ where: { merchantId: merchant.id } })) === 0) {
        for (const p of m.pickups) {
          const area = AREAS.find((a) => a.en === p.area);
          await tx.pickupLocation.create({
            data: {
              merchantId: merchant.id, name: p.name, governorateCode: p.gov, area: p.area, addressLine: p.address,
              lat: area?.lat ?? null, lng: area?.lng ?? null, isDefault: p.isDefault, contactPhone: '+201000000000',
            },
          });
        }
      }
      await tx.user.upsert({
        where: { email: m.owner.email },
        update: {},
        create: { email: m.owner.email, fullName: m.owner.name, role: 'MERCHANT_OWNER', merchantId: merchant.id, passwordHash: hash },
      });
      if ('team' in m && m.team) {
        await tx.user.upsert({
          where: { email: m.team.email },
          update: {},
          create: {
            email: m.team.email, fullName: m.team.name, role: 'MERCHANT_TEAM_MEMBER', merchantId: merchant.id,
            passwordHash: hash, language: 'ar', permissions: ['orders.create', 'orders.view', 'labels.print'],
          },
        });
      }
    }
    log(`users: ${STAFF.length} staff, ${MERCHANTS.length} merchants`);
  }, { timeout: 120000 });

  let seededOrders = false;
  if (opts.demoOrders !== false) {
    const merchants = await prisma.asSystem((tx) => tx.merchant.findMany({ include: { users: true } }));
    for (const m of merchants) {
      const existing = await prisma.asSystem((tx) => tx.order.count({ where: { merchantId: m.id } }));
      if (existing > 0) continue;
      const owner = m.users.find((u) => u.role === 'MERCHANT_OWNER')!;
      const ctx: RequestContext = { userId: owner.id, role: 'MERCHANT_OWNER', merchantId: m.id, franchiseId: null, bypassRls: false, language: 'en' };
      const created = [];
      for (const d of DEMO_ORDERS) {
        created.push(
          await orders.create(ctx, {
            customerName: d.name, customerPhone: d.phone, governorateCode: d.gov, area: d.area, addressLine: d.address,
            codAmount: d.cod, size: d.size, type: d.type, allowOpenPackage: d.open, itemsDescription: `${m.nameEn} items`,
            merchantReference: `${m.code}-${1000 + created.length}`,
          }),
        );
      }
      // Walk two orders forward so timelines have history.
      const ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@shiply.eg' } });
      const opsCtx: RequestContext = { userId: ops.id, role: 'OPERATIONS_MANAGER', merchantId: null, franchiseId: null, bypassRls: true, language: 'en' };
      await orders.transition(ctx, created[0].id, 'PENDING_PICKUP', 'Ready for pickup');
      const path: OrderStatus[] = ['PICKED_UP', 'AT_SORTING_FACILITY', 'IN_TRANSFER', 'AT_LAST_MILE_HUB', 'ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER', 'DELIVERED'];
      for (const s of path) await orders.transition(opsCtx, created[0].id, s);
      await orders.transition(ctx, created[1].id, 'PENDING_PICKUP');
      for (const s of ['PICKED_UP', 'AT_SORTING_FACILITY', 'IN_TRANSFER', 'AT_LAST_MILE_HUB', 'ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER', 'AWAITING_MERCHANT_ACTION'] as OrderStatus[]) {
        await orders.transition(opsCtx, created[1].id, s, s === 'AWAITING_MERCHANT_ACTION' ? 'Failed attempt: Customer is not answering the phone' : undefined);
      }
      // A failed order so the failed delivery charge shows up in the wallet.
      await orders.transition(ctx, created[4].id, 'PENDING_PICKUP');
      for (const s of ['PICKED_UP', 'AT_SORTING_FACILITY', 'IN_TRANSFER', 'AT_LAST_MILE_HUB', 'ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER', 'AWAITING_MERCHANT_ACTION', 'UNSUCCESSFUL'] as OrderStatus[]) {
        await orders.transition(opsCtx, created[4].id, s, s === 'UNSUCCESSFUL' ? 'Customer refused to receive the order' : undefined);
      }
      log(`orders: ${created.length} demo orders for ${m.nameEn}`);
      seededOrders = true;
    }
  }

  if (seededOrders) {
    // Money demo: run the cash cycle, record a driver deposit, open a cashout for Eve Chantelle.
    const finance = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@shiply.eg' } });
    const finCtx: RequestContext = { userId: finance.id, role: 'FINANCE', merchantId: null, franchiseId: null, bypassRls: true, language: 'en' };
    await app.get(SettlementService).run({ triggeredBy: 'seed', ctx: finCtx });
    await app.get(FinanceService).recordDeposit(finCtx, { kind: 'DRIVER_TO_FAWRY', amount: 90000, reference: 'FWR-DEMO-0001', note: 'Demo driver deposit' });
    await app.get(FinanceService).recordDeposit(finCtx, { kind: 'FAWRY_SETTLEMENT', amount: 90000, reference: 'FWR-SETTLE-0001', note: 'Fawry paid the bank' });
    const eve = await prisma.asSystem((tx) => tx.merchant.findUniqueOrThrow({ where: { code: 'EVE' }, include: { users: true } }));
    const eveOwner = eve.users.find((u) => u.role === 'MERCHANT_OWNER')!;
    const eveCtx: RequestContext = { userId: eveOwner.id, role: 'MERCHANT_OWNER', merchantId: eve.id, franchiseId: null, bypassRls: false, language: 'en' };
    await prisma.withContext(eveCtx, (tx) =>
      tx.merchantBankDetails.upsert({
        where: { merchantId: eve.id },
        update: {},
        create: { merchantId: eve.id, bankName: 'CIB', accountName: 'Eve Chantelle LLC', iban: 'EG380019000500000000263180002' },
      }),
    );
    await app.get(CashoutService).request(eveCtx, eve.id, { amount: 20000, method: 'BANK' });
    log('finance: cash cycle run, demo deposits, pending cashout for Eve Chantelle');
  }
  await app.close();
}

if (require.main === module) {
  seed()
    .then(() => {
      console.log(`Seed complete. Demo password for every account: ${DEMO_PASSWORD}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

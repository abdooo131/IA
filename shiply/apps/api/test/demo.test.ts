import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { loadDemo } from '../src/demo/load';
import { LedgerService, WalletsService } from '../src/money';
import { db, resetDb, startApp } from './helpers';

let app: INestApplication;
let first: Awaited<ReturnType<typeof loadDemo>>;
beforeAll(async () => {
  await resetDb();
  app = await startApp();
  first = await loadDemo(app, db);
}, 120_000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('demo data', () => {
  it('fills every step of the parcel flow', async () => {
    expect(first.loaded).toBe(true);
    expect(await db.parcel.count()).toBeGreaterThanOrEqual(120);
    const statuses = (await db.parcel.groupBy({ by: ['status'], _count: true })).map((g) => g.status);
    for (const s of ['created', 'picked_up', 'at_inbound', 'sorted', 'in_transit', 'at_hub', 'out_for_delivery', 'attempt_failed', 'on_hold', 'delivered']) expect(statuses).toContain(s);
    expect(await db.parcel.count({ where: { zoneId: { not: null } } })).toBeGreaterThanOrEqual(100);
  });

  it('leaves work waiting: a gap, an address to place, approvals, a short handover', async () => {
    expect(await db.gap.count({ where: { open: true } })).toBeGreaterThanOrEqual(1);
    expect(await db.addressDecision.count({ where: { status: { in: ['unsure', 'partial', 'not_found'] }, resolvedAt: null } })).toBeGreaterThanOrEqual(3);
    expect(await db.payout.count({ where: { status: 'draft' } })).toBeGreaterThanOrEqual(1);
    expect(await db.bill.count({ where: { status: 'draft' } })).toBeGreaterThanOrEqual(1);
    expect(await db.handover.count({ where: { status: 'disputed' } })).toBe(1);
  });

  it('keeps the books balanced and gives merchants money to pay out', async () => {
    const tb = await app.get(LedgerService).trialBalance();
    expect(tb.reduce((s, r) => s + r.debit - r.credit, 0)).toBe(0);
    const nova = await db.merchant.findUniqueOrThrow({ where: { code: 'NOVA' } });
    expect(await app.get(WalletsService).available(nova.id)).toBeGreaterThan(0);
    expect(await db.journalEntry.count({ where: { sourceType: 'expense' } })).toBeGreaterThanOrEqual(1);
  });

  it('gives each agent a manager login, vehicles, a truck route and a request to answer', async () => {
    expect(await db.agentManager.count()).toBe(2);
    expect(await db.vehicle.count()).toBeGreaterThanOrEqual(8);
    expect(await db.truckRoute.count()).toBeGreaterThanOrEqual(4);
    expect(await db.request.count({ where: { status: 'open' } })).toBeGreaterThanOrEqual(1);
    expect(await db.person.count({ where: { blocked: true } })).toBe(0);
  });

  it('adds nothing the second time', async () => {
    const parcels = await db.parcel.count();
    expect((await loadDemo(app, db)).loaded).toBe(false);
    expect(await db.parcel.count()).toBe(parcels);
  });
});

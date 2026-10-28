import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocation } from '../src/locations';
import { move, receive } from '../src/stock';
import {
  approveTransfer,
  cancelTransfer,
  closeTransfer,
  createTransfer,
  pickForTransfer,
  receiveTransfer,
  sendTransfer,
} from '../src/transfers';
import { binQty, createFixture, level, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let hub: { id: string };
let n = 0;
const key = () => `tr-${++n}-${Math.random()}`;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  hub = await createLocation(prisma, {
    kind: 'hub',
    code: 'HUB',
    nameEn: 'Hub',
    nameAr: 'مركز',
    addressEn: 'Industrial zone',
    addressAr: 'المنطقة الصناعية',
    governorateId: 1,
    latitude: 30.1,
    longitude: 31.3,
    shelves: 2,
    actorUserId: admin,
  });
  // The other fixture store needs receiving to take deliveries.
  await prisma.bin.create({ data: { darkStoreId: f.other.id, code: 'RCV', type: 'receiving' } });
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
});

afterAll(() => prisma.$disconnect());

const pick = (transferId: string, darkStoreId: string, quantity = 1) =>
  pickForTransfer(prisma, {
    transferId,
    darkStoreId,
    skuId: f.sku.id,
    quantity,
    actorUserId: admin,
    idempotencyKey: key(),
  });
const take = (transferId: string, darkStoreId: string, quantity = 1) =>
  receiveTransfer(prisma, {
    transferId,
    darkStoreId,
    skuId: f.sku.id,
    quantity,
    actorUserId: admin,
    idempotencyKey: key(),
  });
const hubBin = (code: string) =>
  prisma.bin.findFirstOrThrow({ where: { darkStoreId: hub.id, code } });

describe('transfers', () => {
  it('moves store to store through the hub, cross docking at the hub', async () => {
    const leg1 = await createTransfer(prisma, {
      fromId: f.store.id,
      toId: f.other.id,
      lines: [{ skuId: f.sku.id, quantity: 2 }],
      actorUserId: admin,
    });
    // The first leg ends at the hub and remembers where the units are going.
    expect(leg1).toMatchObject({
      toId: hub.id,
      finalDestinationId: f.other.id,
      status: 'approved',
    });
    expect(leg1.reference).toBe('TRF-1001');
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 5, reserved: 2 });

    await pick(leg1.id, f.store.id, 2);
    await sendTransfer(prisma, {
      transferId: leg1.id,
      darkStoreId: f.store.id,
      actorUserId: admin,
    });
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 3, reserved: 0 });

    await take(leg1.id, hub.id, 2);
    const closed = await closeTransfer(prisma, {
      transferId: leg1.id,
      darkStoreId: hub.id,
      actorUserId: admin,
    });
    expect(closed.short).toBe(false);
    expect(await binQty((await hubBin('RCV-01')).id, f.sku.id)).toBe(2);

    // The onward leg is picked straight from the hub's receiving bin.
    const leg2 = closed.onwardId!;
    expect(await pick(leg2, hub.id, 2)).toMatchObject({ bin: 'RCV-01' });
    await sendTransfer(prisma, { transferId: leg2, darkStoreId: hub.id, actorUserId: admin });
    await take(leg2, f.other.id, 2);
    await closeTransfer(prisma, { transferId: leg2, darkStoreId: f.other.id, actorUserId: admin });
    const rcv = await prisma.bin.findFirstOrThrow({
      where: { darkStoreId: f.other.id, code: 'RCV' },
    });
    expect(await binQty(rcv.id, f.sku.id)).toBe(2);
    const movements = await prisma.stockMovement.count({ where: { transferId: { not: null } } });
    expect(movements).toBe(4);
  });

  it('joins units bound for the same store onto one onward trip', async () => {
    const send = async () => {
      const t = await createTransfer(prisma, {
        fromId: f.store.id,
        toId: f.other.id,
        lines: [{ skuId: f.sku.id, quantity: 1 }],
        actorUserId: admin,
      });
      await pick(t.id, f.store.id);
      await sendTransfer(prisma, { transferId: t.id, darkStoreId: f.store.id, actorUserId: admin });
      await take(t.id, hub.id);
      return closeTransfer(prisma, { transferId: t.id, darkStoreId: hub.id, actorUserId: admin });
    };
    const a = await send();
    const b = await send();
    expect(b.onwardId).toBe(a.onwardId);
    const line = await prisma.transferLine.findFirstOrThrow({ where: { transferId: a.onwardId! } });
    expect(line.quantity).toBe(2);
  });

  it('holds hub shelf stock for a hub to store leg, and releases what is not found', async () => {
    const shelf = await hubBin('A-01');
    await receive(prisma, { skuId: f.sku.id, binId: (await hubBin('RCV-01')).id, quantity: 4 });
    await move(prisma, {
      skuId: f.sku.id,
      fromBinId: (await hubBin('RCV-01')).id,
      toBinId: shelf.id,
      quantity: 4,
    });
    const t = await createTransfer(prisma, {
      fromId: hub.id,
      toId: f.store.id,
      lines: [{ skuId: f.sku.id, quantity: 3 }],
      actorUserId: admin,
    });
    expect(t.toId).toBe(f.store.id);
    expect(await level(hub.id, f.sku.id)).toEqual({ onHand: 4, reserved: 3 });
    await pick(t.id, hub.id, 2);
    await expect(pick(t.id, hub.id, 2)).rejects.toMatchObject({ code: 'over_pick' });
    await sendTransfer(prisma, { transferId: t.id, darkStoreId: hub.id, actorUserId: admin });
    expect(await level(hub.id, f.sku.id)).toEqual({ onHand: 2, reserved: 0 });
    expect(await prisma.alert.count({ where: { type: 'transfer_short_sent' } })).toBe(1);

    // One unit arrives; closing records the missing one.
    await take(t.id, f.store.id, 1);
    await expect(take(t.id, f.store.id, 2)).rejects.toMatchObject({ code: 'over_receive' });
    await closeTransfer(prisma, { transferId: t.id, darkStoreId: f.store.id, actorUserId: admin });
    expect(await prisma.alert.count({ where: { type: 'transfer_short_received' } })).toBe(1);
  });

  it('keeps refill drafts unheld until admin approves, and cancel gives units back', async () => {
    const draft = await createTransfer(prisma, {
      fromId: f.store.id,
      toId: hub.id,
      lines: [{ skuId: f.sku.id, quantity: 3 }],
      draft: true,
      origin: 'refill',
      actorUserId: null,
    });
    expect(draft.status).toBe('draft');
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 5, reserved: 0 });
    await expect(pick(draft.id, f.store.id)).rejects.toMatchObject({
      code: 'invalid_transfer_state',
    });
    await approveTransfer(prisma, {
      transferId: draft.id,
      lines: [{ skuId: f.sku.id, quantity: 2 }],
      actorUserId: admin,
    });
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 5, reserved: 2 });
    await cancelTransfer(prisma, { transferId: draft.id, actorUserId: admin });
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 5, reserved: 0 });
  });

  it('refuses more than is available and picks applied twice', async () => {
    await expect(
      createTransfer(prisma, {
        fromId: f.store.id,
        toId: hub.id,
        lines: [{ skuId: f.sku.id, quantity: 9 }],
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'not_enough_available' });
    const t = await createTransfer(prisma, {
      fromId: f.store.id,
      toId: hub.id,
      lines: [{ skuId: f.sku.id, quantity: 2 }],
      actorUserId: admin,
    });
    const input = {
      transferId: t.id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 1,
      actorUserId: admin,
      idempotencyKey: 'same',
    };
    await pickForTransfer(prisma, input);
    expect(await pickForTransfer(prisma, input)).toMatchObject({ replayed: true });
    expect(
      (await prisma.transferLine.findFirstOrThrow({ where: { transferId: t.id } })).pickedQty,
    ).toBe(1);
  });
});

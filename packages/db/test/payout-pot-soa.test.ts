import type { PayoutStatementData } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addPayoutProof,
  createPayout,
  createPayoutCheck,
  getPayoutProofFile,
  getPayoutStatement,
  listPayoutChecks,
  markPayoutCheck,
  markPayoutPaid,
  markPayoutsPaid,
  merchantOwed,
  payoutControls,
  payoutStatementCsv,
  post,
  prepareDuePayouts,
  updatePayoutCheck,
} from '../src/finance';
import { createOrder } from '../src/orders';
import { receive } from '../src/stock';
import { createFixture, prisma, readyToPay, resetDatabase, slipPdf } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let payer: string;
let viewer: string;
let n = 0;
const key = () => `pot-${++n}-${Math.random()}`;

const user = (email: string, name: string) =>
  prisma.user.create({ data: { email, name, role: 'finance', passwordHash: 'x' } });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  payer = (await user('payer@t.eg', 'Payer')).id;
  viewer = (await user('viewer@t.eg', 'Viewer')).id;
  // The bank holds enough for every payout here.
  await post(prisma, {
    kind: 'test_capital',
    idempotencyKey: key(),
    lines: [
      { account: { type: 'bank' }, amount: 10_000_000 },
      { account: { type: 'retained_earnings' }, amount: -10_000_000 },
    ],
  });
});

afterAll(() => prisma.$disconnect());

/** COD collected for the merchant, optionally for an order. */
const cod = (amount: number, orderId?: string, merchantId = f.merchant.id) =>
  post(prisma, {
    kind: 'cod_collected',
    idempotencyKey: key(),
    orderId,
    lines: [
      { account: { type: 'store_cash', darkStoreId: f.store.id }, amount },
      { account: { type: 'merchant', merchantId }, amount: -amount },
    ],
  });

/** A fee with 14% VAT taken from the merchant's balance. */
const fee = (kind: string, net: number, orderId?: string) =>
  post(prisma, {
    kind,
    idempotencyKey: key(),
    orderId,
    lines: [
      { account: { type: 'merchant', merchantId: f.merchant.id }, amount: net + (net * 14) / 100 },
      { account: { type: 'revenue' }, amount: -net },
      { account: { type: 'vat_payable' }, amount: -(net * 14) / 100 },
    ],
  });

async function anOrder() {
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
  return createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Customer',
    customerPhone: '01012345678',
    addressText: 'Somewhere in Cairo',
    paymentMethod: 'cod',
    deliveryFeePiastres: 3000,
    items: [{ skuId: f.sku.id, quantity: 1 }],
    actorUserId: payer,
  });
}

const draft = (merchantId = f.merchant.id) =>
  createPayout(prisma, { merchantId, cutoffAt: new Date(), actorUserId: payer });

const proof = (payoutId: string, amountPiastres: number, actorUserId = payer) =>
  addPayoutProof(prisma, {
    payoutId,
    fileName: 'slip.pdf',
    contentType: 'application/pdf',
    data: slipPdf(),
    amountPiastres,
    reference: 'CIB-778899',
    actorUserId,
  });

const secondPerson = async () =>
  (await listPayoutChecks(prisma, { activeOnly: true })).find(
    (c) => c.code === 'second_person_viewed',
  )!;

describe('statement of account', () => {
  it('is frozen with the draft: per order, by kind, with VAT, net equal to the payout', async () => {
    const order = await anOrder();
    await cod(50_000, order.id);
    await fee('order_fee', 1_000, order.id);
    await fee('cod_fee', 500, order.id);
    await fee('storage_fee', 200);
    const payout = await draft();
    expect(payout.amountPiastres).toBe(50_000 - 1_140 - 570 - 228);

    const s = await getPayoutStatement(prisma, payout.id);
    expect(s.number).toBe('SOA-000001');
    expect(s.payout.number).toBe('PAY-000001');
    expect(s.openingPiastres).toBe(0);
    expect(s.closingPiastres).toBe(payout.amountPiastres);
    expect(s.netPiastres).toBe(payout.amountPiastres);
    expect(s.heldBackPiastres).toBe(0);
    expect(s.byKind).toEqual({
      cod_collected: 50_000,
      order_fee: -1_140,
      cod_fee: -570,
      storage_fee: -228,
    });
    expect(s.vatByKind).toEqual({ order_fee: -140, cod_fee: -70, storage_fee: -28 });
    expect(s.vatPiastres).toBe(-238);
    expect(s.orders).toEqual([
      {
        orderId: order.id,
        orderNumber: order.number,
        codPiastres: 50_000,
        fees: { order_fee: -1_140, cod_fee: -570 },
        vatPiastres: -210,
        netPiastres: 48_290,
      },
    ]);
    expect(s.other.map((o) => o.kind)).toEqual(['storage_fee']);
    expect(payoutStatementCsv(s)).toContain('net_to_transfer');

    // Never changed afterwards, even by hand in the database.
    await expect(
      prisma.payoutStatement.updateMany({
        where: { payoutId: payout.id },
        data: { netPiastres: 1 },
      }),
    ).rejects.toThrow('payout_statement_frozen');
    await expect(prisma.payoutStatement.deleteMany({})).rejects.toThrow('payout_statement_frozen');
    expect(
      await prisma.auditLog.count({
        where: { action: 'finance.payout_statement', entityId: payout.id },
      }),
    ).toBe(1);
  });

  it('numbers statements without gaps and starts a period at the last paid cutoff', async () => {
    await cod(10_000);
    const first = await draft();
    await readyToPay(first.id, { uploaderId: payer, viewerId: viewer });
    await markPayoutPaid(prisma, { payoutId: first.id, actorUserId: payer });
    await cod(7_000);
    const second = await draft();
    const s = await getPayoutStatement(prisma, second.id);
    expect(s.number).toBe('SOA-000002');
    // The first payout went out after its cutoff, so it shows in this period.
    expect(s.byKind).toMatchObject({ cod_collected: 7_000, merchant_payout: -10_000 });
    expect(s.openingPiastres).toBe(10_000);
    expect(s.closingPiastres).toBe(7_000);
    expect(s.netPiastres).toBe(7_000);

    // Prepared by the run, each draft has its statement too.
    const other = await prisma.merchant.create({
      data: { name: 'Other', payoutSchedule: 'daily' },
    });
    await cod(3_000, undefined, other.id);
    const run = await prepareDuePayouts(prisma, {
      cutoffDay: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      actorUserId: payer,
    });
    const created = run.created.find((c) => c.merchantId === other.id)!;
    expect((await getPayoutStatement(prisma, created.payoutId)).number).toBe('SOA-000003');
    // A merchant only reads their own.
    await expect(getPayoutStatement(prisma, created.payoutId, f.merchant.id)).rejects.toThrow(
      'statement_not_found',
    );
  });

  it('shows charges after the cutoff as held back, so the net stays the payout', async () => {
    await cod(10_000);
    const cutoffAt = new Date();
    await new Promise((r) => setTimeout(r, 5));
    await fee('storage_fee', 1_000); // 11.40 EGP after the cutoff
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt,
      actorUserId: payer,
    });
    expect(payout.amountPiastres).toBe(8_860);
    const s = await getPayoutStatement(prisma, payout.id);
    expect(s).toMatchObject({
      closingPiastres: 10_000,
      heldBackPiastres: 1_140,
      netPiastres: 8_860,
    });
  });
});

describe('proof of transfer', () => {
  it('is required, and its amount must be the payout amount', async () => {
    await cod(12_345);
    const payout = await draft();
    await expect(
      markPayoutPaid(prisma, { payoutId: payout.id, reference: 'X1', actorUserId: payer }),
    ).rejects.toMatchObject({ code: 'pot_required' });
    await expect(proof(payout.id, 12_340)).rejects.toMatchObject({ code: 'pot_amount_mismatch' });
    await expect(
      addPayoutProof(prisma, {
        payoutId: payout.id,
        fileName: 'slip.txt',
        contentType: 'text/plain',
        data: Buffer.from('hello'),
        amountPiastres: 12_345,
        reference: 'CIB-1',
        actorUserId: payer,
      }),
    ).rejects.toMatchObject({ code: 'file_type_not_allowed' });
    await expect(
      addPayoutProof(prisma, {
        payoutId: payout.id,
        fileName: 'slip.pdf',
        contentType: 'image/png',
        data: slipPdf(),
        amountPiastres: 12_345,
        reference: 'CIB-1',
        actorUserId: payer,
      }),
    ).rejects.toMatchObject({ code: 'file_type_not_allowed' });
    const pot = await proof(payout.id, 12_345);
    expect(pot.number).toBe('POT-000001');

    // Still not paid without the second person.
    await expect(
      markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: payer }),
    ).rejects.toMatchObject({ code: 'checks_incomplete' });
    await markPayoutCheck(prisma, {
      payoutId: payout.id,
      checkId: (await secondPerson()).id,
      actorUserId: viewer,
    });
    // The reference comes from the proof.
    await markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: payer });
    const paid = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(paid).toMatchObject({ status: 'paid', reference: 'CIB-778899' });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(0);

    // A paid payout's proof and ticks are fixed.
    await expect(
      prisma.payoutProof.updateMany({ where: { payoutId: payout.id }, data: { reference: 'Y' } }),
    ).rejects.toThrow('payout_paid_frozen');
    await expect(prisma.payoutCheckMark.deleteMany({})).rejects.toThrow('payout_paid_frozen');
    await expect(proof(payout.id, 12_345)).rejects.toMatchObject({ code: 'payout_not_draft' });
    expect((await getPayoutProofFile(prisma, payout.id, f.merchant.id)).contentType).toBe(
      'application/pdf',
    );
    const second = await draft().catch((e: { code: string }) => e.code);
    expect(second).toBe('nothing_to_pay');
  });

  it('refuses when the frozen statement does not match the payout', async () => {
    await cod(5_000);
    const payout = await draft();
    await readyToPay(payout.id, { uploaderId: payer, viewerId: viewer });
    await prisma.$executeRawUnsafe('ALTER TABLE payout_statements DISABLE TRIGGER USER');
    await prisma.payoutStatement.updateMany({
      where: { payoutId: payout.id },
      data: { netPiastres: 4_000 },
    });
    await prisma.$executeRawUnsafe('ALTER TABLE payout_statements ENABLE TRIGGER USER');
    await expect(
      markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: payer }),
    ).rejects.toMatchObject({ code: 'soa_mismatch' });
  });

  it('can be replaced before payment, clearing the ticks given on the old one', async () => {
    await cod(5_000);
    const payout = await draft();
    await proof(payout.id, 5_000);
    const check = await secondPerson();
    await markPayoutCheck(prisma, { payoutId: payout.id, checkId: check.id, actorUserId: viewer });
    const again = await proof(payout.id, 5_000);
    expect(again.number).toBe('POT-000001');
    expect(await prisma.payoutCheckMark.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'finance.payout_proof_replace' } })).toBe(
      1,
    );
  });
});

describe('payout checks', () => {
  it('refuses the payer as the second person and needs every active check', async () => {
    await cod(9_000);
    const payout = await draft();
    const check = await secondPerson();
    // The second person confirms the statement and the proof, so the proof comes first.
    await expect(
      markPayoutCheck(prisma, { payoutId: payout.id, checkId: check.id, actorUserId: viewer }),
    ).rejects.toMatchObject({ code: 'pot_required' });
    await proof(payout.id, 9_000);
    await markPayoutCheck(prisma, { payoutId: payout.id, checkId: check.id, actorUserId: payer });
    await expect(
      markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: payer }),
    ).rejects.toMatchObject({ code: 'same_person' });
    const controls = await payoutControls(prisma, payout.id, payer);
    expect(controls.blockers).toEqual(['same_person']);
    expect(controls.matches).toBe(true);

    // A custom check: anyone with accounting use ticks it, the payer included.
    const custom = await createPayoutCheck(prisma, {
      code: 'iban_matches',
      labelEn: 'IBAN on the slip matches the merchant',
      labelAr: 'رقم الحساب في الإيصال مطابق للتاجر',
      actorUserId: payer,
    });
    await expect(
      createPayoutCheck(prisma, {
        code: 'iban_matches',
        labelEn: 'Again and again',
        labelAr: 'مرة أخرى',
        actorUserId: payer,
      }),
    ).rejects.toMatchObject({ code: 'check_code_taken' });
    // The payout is paid by the viewer now (the payer ticked the second person check).
    await expect(
      markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: viewer }),
    ).rejects.toMatchObject({ code: 'checks_incomplete' });
    await markPayoutCheck(prisma, { payoutId: payout.id, checkId: custom.id, actorUserId: viewer });
    await markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: viewer });
    expect(
      await prisma.auditLog.count({
        where: { action: 'finance.payout_check', entityId: payout.id },
      }),
    ).toBe(2);

    // A check switched off no longer counts; the system check cannot be switched off.
    await updatePayoutCheck(prisma, { id: custom.id, active: false, actorUserId: payer });
    expect((await listPayoutChecks(prisma, { activeOnly: true })).map((c) => c.code)).toEqual([
      'second_person_viewed',
    ]);
    await expect(
      updatePayoutCheck(prisma, { id: check.id, active: false, actorUserId: payer }),
    ).rejects.toMatchObject({ code: 'check_is_system' });
  });
});

describe('pay merchants run', () => {
  it('takes one proof per payout and refuses rows without one', async () => {
    const other = await prisma.merchant.create({ data: { name: 'Other' } });
    await cod(4_000);
    await cod(6_000, undefined, other.id);
    const a = await draft();
    const b = await draft(other.id);
    await readyToPay(a.id, { uploaderId: payer, viewerId: viewer, reference: 'CIB-A' });
    const result = await markPayoutsPaid(prisma, { ids: [a.id, b.id], actorUserId: payer });
    expect(result.results).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: false, error: 'pot_required' },
    ]);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: a.id } })).reference).toBe(
      'CIB-A',
    );
    // Pressing again: the paid one is done, the other still waits for its proof.
    const again = await markPayoutsPaid(prisma, { ids: [a.id, b.id], actorUserId: payer });
    expect(again.results).toEqual([
      { id: a.id, ok: true, already: true },
      { id: b.id, ok: false, error: 'pot_required' },
    ]);
    const data = (await prisma.payoutStatement.findUniqueOrThrow({ where: { payoutId: b.id } }))
      .data as unknown as PayoutStatementData;
    expect(data.merchant.name).toBe('Other');
  });
});

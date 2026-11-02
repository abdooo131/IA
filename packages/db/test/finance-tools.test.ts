import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMonths,
  balanceOf,
  createPayout,
  createSupplier,
  disposeAsset,
  ensureDefaultAccounts,
  linkSupplierToMerchant,
  listFixedAssets,
  listPartners,
  partnerLedger,
  payBill,
  payoutBankFile,
  post,
  recordAssetPurchase,
  recordBill,
  recordCapital,
  recordJournalEntry,
  reverseAccruals,
  runMonthlyCharges,
  updateMerchantBank,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `tool-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 50_000_000,
    reference: 'Owner',
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('bills in another currency', () => {
  it('books at the bill rate and puts the rate change in exchange differences', async () => {
    const cib = await byKey('bank');
    const google = await createSupplier(prisma, {
      name: 'Google Cloud',
      defaultExpenseAccountId: (await byKey('expense:utilities')).id,
      actorUserId: admin,
    });
    const day = cairoDay(new Date());
    // 100 USD at 48.50 = 4,850 EGP.
    const bill = await recordBill(prisma, {
      supplierId: google.id,
      reference: 'G-1',
      billDate: day,
      dueDate: day,
      currency: 'USD',
      foreignNetCents: 10_000,
      fxRate: '48.50',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(bill).toMatchObject({ totalPiastres: 485_000, currency: 'USD', foreignTotal: 10_000 });
    const before = await balanceOf(prisma, { id: cib.id });
    // Half at 49.00, then the rest at 50.00.
    await payBill(prisma, {
      billId: bill.id,
      foreignAmountCents: 5_000,
      fxRate: '49',
      moneyAccountId: cib.id,
      reference: 'C1',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await payBill(prisma, {
      billId: bill.id,
      foreignAmountCents: 5_000,
      fxRate: '50',
      moneyAccountId: cib.id,
      reference: 'C2',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before - 245_000 - 250_000);
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: google.id })).toBe(0);
    expect(await balanceOf(prisma, { type: 'fx_difference' })).toBe(10_000);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe('paid');
  });
});

describe('equipment sold or scrapped', () => {
  it('takes the asset off the books with the loss and stops depreciation', async () => {
    const cib = await byKey('bank');
    const thisMonth = cairoDay(new Date()).slice(0, 7);
    await recordAssetPurchase(prisma, {
      name: 'Scooter',
      amountPiastres: 1_200_000,
      lifeMonths: 12,
      startMonth: addMonths(thisMonth, -2),
      moneyAccountId: cib.id,
      reference: 'Dealer',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await runMonthlyCharges(prisma);
    const [asset] = await listFixedAssets(prisma);
    expect(asset!.depreciatedPiastres).toBe(200_000);
    await disposeAsset(prisma, {
      assetId: asset!.id,
      salePiastres: 700_000,
      moneyAccountId: cib.id,
      reason: 'Sold to a dealer',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // 12,000 cost − 2,000 depreciated − 7,000 sale = 3,000 loss.
    expect(await balanceOf(prisma, { type: 'asset_disposal' })).toBe(300_000);
    expect(await balanceOf(prisma, { type: 'fixed_assets' })).toBe(0);
    expect(await balanceOf(prisma, { type: 'accumulated_depreciation' })).toBe(0);
    expect((await runMonthlyCharges(prisma, new Date(Date.now() + 70 * 86_400_000))).charged).toBe(
      0,
    );
    await expect(
      disposeAsset(prisma, {
        assetId: asset!.id,
        salePiastres: 0,
        reason: 'Again please',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('asset_already_disposed');
  });
});

describe('accruals', () => {
  it('reverse themselves on the first day of the next month, once', async () => {
    const yesterday = addDays(cairoDay(new Date()), -1);
    await recordJournalEntry(prisma, {
      lines: [
        {
          accountId: (await byKey('expense:utilities')).id,
          debitPiastres: 30_000,
          creditPiastres: 0,
        },
        { accountId: (await byKey('equity:capital')).id, debitPiastres: 0, creditPiastres: 30_000 },
      ],
      reason: 'Electricity used, bill not here yet',
      day: yesterday,
      reverseNextMonth: true,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect((await reverseAccruals(prisma)).reversed).toBe(0);
    const nextMonth = new Date(Date.now() + 40 * 86_400_000);
    expect((await reverseAccruals(prisma, nextMonth)).reversed).toBe(1);
    expect((await reverseAccruals(prisma, nextMonth)).reversed).toBe(0);
    expect(await balanceOf(prisma, { id: (await byKey('expense:utilities')).id })).toBe(0);
  });
});

describe('payout bank file and partner ledger', () => {
  it('lists payouts ready for the bank and one ledger per partner', async () => {
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: key(),
      occurredAt: new Date(Date.now() - 3 * 86_400_000),
      lines: [
        { account: { type: 'bank' }, amount: 100_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -100_000 },
      ],
    });
    await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: admin,
    });
    let file = await payoutBankFile(prisma);
    expect(file.blocked[0]).toMatchObject({ reason: 'bank_details_missing' });
    await expect(
      updateMerchantBank(prisma, { merchantId: f.merchant.id, iban: 'EG12', actorUserId: admin }),
    ).rejects.toThrow('invalid_iban');
    await updateMerchantBank(prisma, {
      merchantId: f.merchant.id,
      iban: 'EG380019000500000000263180002',
      beneficiaryName: 'Eve LLC',
      actorUserId: admin,
    });
    file = await payoutBankFile(prisma);
    expect(file.ready[0]).toMatchObject({ beneficiary: 'Eve LLC', amountPiastres: 100_000 });

    // The merchant is also a supplier of ours: one partner, one net.
    const supplier = await createSupplier(prisma, {
      name: 'Eve supplies',
      defaultExpenseAccountId: (await byKey('expense:packaging')).id,
      actorUserId: admin,
    });
    await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'E-1',
      billDate: cairoDay(new Date()),
      dueDate: cairoDay(new Date()),
      netPiastres: 20_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await linkSupplierToMerchant(prisma, {
      supplierId: supplier.id,
      merchantId: f.merchant.id,
      actorUserId: admin,
    });
    const partners = await listPartners(prisma);
    const eve = partners.find((p) => p.kind === 'merchant' && p.id === f.merchant.id)!;
    expect(eve).toMatchObject({ accounts: 2, netPiastres: -120_000 });
    expect(partners.some((p) => p.kind === 'supplier' && p.id === supplier.id)).toBe(false);
    const ledger = await partnerLedger(prisma, { kind: 'merchant', id: f.merchant.id });
    expect(ledger.netPiastres).toBe(-120_000);
    expect(ledger.lines.at(-1)!.runningPiastres).toBe(-120_000);
  });
});

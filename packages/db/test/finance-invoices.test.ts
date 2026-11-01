import { cairoDay, cairoDayStart, etaCanonical } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMonths,
  balanceOf,
  createSignerKey,
  documentsToSign,
  ensureDefaultAccounts,
  etaReadiness,
  getInvoice,
  issueCreditNote,
  listInvoices,
  post,
  prepareInvoices,
  recordEtaResult,
  resendInvoice,
  saveSignatures,
  signerKeyValid,
  updateCompanyProfile,
  updateMerchantTax,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `inv-${++n}-${Math.random()}`;
const lastMonth = () => addMonths(cairoDay(new Date()).slice(0, 7), -1);

async function fee(kind: string, net: number, vat: number, at: Date) {
  await post(prisma, {
    kind,
    idempotencyKey: key(),
    occurredAt: at,
    lines: [
      { account: { type: 'merchant', merchantId: f.merchant.id }, amount: net + vat },
      { account: { type: 'revenue' }, amount: -net },
      { account: { type: 'vat_payable' }, amount: -vat },
    ],
  });
}

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  const at = new Date(cairoDayStart(`${lastMonth()}-10`).getTime() + 3600_000);
  await fee('order_fee', 10_000, 1_400, at);
  await fee('order_fee', 10_000, 1_400, at);
  await fee('storage_fee', 500, 70, at);
});

afterAll(() => prisma.$disconnect());

describe('tax invoices', () => {
  it('issues one invoice per merchant and month from the booked fees', async () => {
    await expect(
      prepareInvoices(prisma, { month: cairoDay(new Date()).slice(0, 7), actorUserId: admin }),
    ).rejects.toThrow('month_not_over');
    expect(await prepareInvoices(prisma, { month: lastMonth(), actorUserId: admin })).toEqual({
      month: lastMonth(),
      created: 1,
    });
    // Twice changes nothing.
    expect(
      (await prepareInvoices(prisma, { month: lastMonth(), actorUserId: admin })).created,
    ).toBe(0);
    const [invoice] = await listInvoices(prisma);
    expect(invoice).toMatchObject({
      label: 'INV-000001',
      netPiastres: 20_500,
      vatPiastres: 2_870,
      totalPiastres: 23_370,
      etaStatus: 'not_sent',
    });
    const full = await getInvoice(prisma, invoice!.id);
    expect(full.lines.map((l) => [l.kind, l.quantity, l.netPiastres])).toEqual(
      expect.arrayContaining([
        ['order_fee', 2, 20_000],
        ['storage_fee', 1, 500],
      ]),
    );
    // Amounts are fixed once issued.
    await expect(
      prisma.taxInvoice.update({ where: { id: invoice!.id }, data: { netPiastres: 1 } }),
    ).rejects.toThrow();

    // A credit note gives back part of the fees with their VAT, never more than invoiced.
    await expect(
      issueCreditNote(prisma, {
        invoiceId: invoice!.id,
        amountPiastres: 30_000,
        reason: 'Too much',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('more_than_invoiced');
    const before = await balanceOf(prisma, { type: 'merchant', merchantId: f.merchant.id });
    await issueCreditNote(prisma, {
      invoiceId: invoice!.id,
      amountPiastres: 10_000,
      reason: 'Order delivered late',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await balanceOf(prisma, { type: 'merchant', merchantId: f.merchant.id })).toBe(
      before - 11_400,
    );
    const notes = (await listInvoices(prisma)).filter((i) => i.type === 'credit_note');
    expect(notes[0]).toMatchObject({
      label: 'CN-000001',
      vatPiastres: 1_400,
      original: 'INV-000001',
    });
  });
});

describe('e-invoice flow', () => {
  it('hands out documents to sign only when everything is set, then records the answers', async () => {
    await prepareInvoices(prisma, { month: lastMonth(), actorUserId: admin });
    const notReady = await documentsToSign(prisma);
    expect(notReady.ready).toBe(false);
    expect(notReady.missing).toContain('tax_registration_number');

    await updateCompanyProfile(prisma, {
      legalNameAr: 'شيبلي ناو',
      taxRegistrationNumber: '123456789',
      activityCode: '5320',
      governorate: 'Cairo',
      regionCity: 'Nasr City',
      street: 'Abbas El Akkad',
      buildingNumber: '10',
      itemCodes: {
        order_fee: 'EG-123456789-1',
        cod_fee: 'EG-123456789-2',
        failed_fee: 'EG-123456789-3',
        receiving_fee: 'EG-123456789-4',
        storage_fee: 'EG-123456789-5',
        return_fee: 'EG-123456789-6',
        adjustment: 'EG-123456789-7',
      },
      etaEnabled: true,
      actorUserId: admin,
    });
    const { key: signerKey } = await createSignerKey(prisma, { actorUserId: admin });
    expect(await signerKeyValid(prisma, signerKey)).toBe(true);
    expect(await signerKeyValid(prisma, 'snsk_wrong')).toBe(false);
    expect((await etaReadiness(prisma)).ready).toBe(true);

    await expect(
      updateMerchantTax(prisma, {
        merchantId: f.merchant.id,
        taxRegistrationNumber: '12',
        actorUserId: admin,
      }),
    ).rejects.toThrow('invalid_tax_number');
    // A company merchant needs its address before its invoice can go.
    await updateMerchantTax(prisma, {
      merchantId: f.merchant.id,
      legalName: 'Eve Chantelle LLC',
      taxRegistrationNumber: '987654321',
      actorUserId: admin,
    });
    const blocked = await documentsToSign(prisma);
    expect(blocked.documents).toHaveLength(0);
    expect(blocked.blocked[0]).toMatchObject({ reason: 'merchant_address_missing' });
    await updateMerchantTax(prisma, {
      merchantId: f.merchant.id,
      taxGovernorate: 'Giza',
      taxRegionCity: 'Dokki',
      taxStreet: 'Tahrir',
      taxBuildingNumber: '5',
      actorUserId: admin,
    });
    const pending = await documentsToSign(prisma);
    expect(pending.documents).toHaveLength(1);
    const doc = pending.documents[0]!;
    // The text handed out is exactly the canonical form of the stored document.
    const stored = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: doc.id } });
    expect(doc.canonical).toBe(etaCanonical(stored.document as never));
    expect(doc.canonical).toContain('"GOVERNATE""Giza"');
    expect(doc.canonical).toContain('"RECEIVER"');

    expect(
      await saveSignatures(prisma, { signatures: [{ id: doc.id, signature: 'MIIB...' }] }),
    ).toEqual({ saved: 1 });
    // A second signature for the same document is ignored.
    expect(
      await saveSignatures(prisma, { signatures: [{ id: doc.id, signature: 'other' }] }),
    ).toEqual({ saved: 0 });
    await recordEtaResult(prisma, {
      id: doc.id,
      status: 'rejected',
      error: { message: 'bad code' },
    });
    await resendInvoice(prisma, { id: doc.id, actorUserId: admin });
    const again = await documentsToSign(prisma);
    expect(again.documents[0]!.id).toBe(doc.id);
    await saveSignatures(prisma, { signatures: [{ id: doc.id, signature: 'MIIB2' }] });
    await recordEtaResult(prisma, { id: doc.id, status: 'valid', uuid: 'UUID1', longId: 'L1' });
    expect((await listInvoices(prisma))[0]).toMatchObject({ etaStatus: 'valid', etaUuid: 'UUID1' });
  });
});

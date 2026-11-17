import { describe, expect, it } from 'vitest';
import { etaCanonical, etaDocument } from './eta';

describe('ETA canonical form', () => {
  it('follows the tax authority serialization rules', () => {
    // The example from the ETA SDK: names in capitals, arrays repeat their name.
    expect(
      etaCanonical({
        issuer: { address: { branchID: '0', country: 'EG' }, type: 'B' },
        invoiceLines: [{ quantity: 1, taxableItems: [{ taxType: 'T1', amount: 14 }] }],
        signatures: [{ signatureType: 'I', value: 'x' }],
      }),
    ).toBe(
      '"ISSUER""ADDRESS""BRANCHID""0""COUNTRY""EG""TYPE""B"' +
        '"INVOICELINES""INVOICELINES""QUANTITY""1""TAXABLEITEMS""TAXABLEITEMS""TAXTYPE""T1""AMOUNT""14"',
    );
  });

  it('builds a document whose totals add up', () => {
    const party = {
      type: 'B' as const,
      id: '123456789',
      name: 'Shiply Now',
      governorate: 'Cairo',
      regionCity: 'Nasr City',
      street: 'Abbas El Akkad',
      buildingNumber: '1',
    };
    const doc = etaDocument({
      type: 'I',
      issuer: party,
      receiver: { ...party, id: '987654321', name: 'Eve Chantelle' },
      issuedAt: new Date('2026-11-30T21:59:59.999Z'),
      activityCode: '5320',
      internalId: 'INV-000001',
      lines: [
        {
          description: 'Order fee',
          itemCode: 'EG-123456789-FEE',
          internalCode: 'order_fee',
          quantity: 3,
          netPiastres: 30_000,
          vatPiastres: 4_200,
          vatRate: 14,
        },
      ],
    });
    expect(doc).toMatchObject({
      dateTimeIssued: '2026-11-30T21:59:59Z',
      totalSalesAmount: 300,
      totalAmount: 342,
      taxTotals: [{ taxType: 'T1', amount: 42 }],
    });
    expect(JSON.stringify(doc)).not.toContain('signatures');
  });
});

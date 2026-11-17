import type { INestApplication } from '@nestjs/common';
import { post } from '@shiplynow/db';
import { cairoDay, cairoDayStart } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EtaClient, type EtaDocumentStatus, type EtaSubmission } from '../src/finance/eta';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `finv-${++n}-${Date.now()}`;

/** The tax authority, as a fake: accepts every document, then says Valid. */
class FakeEta extends EtaClient {
  readonly enabled = true;
  submitted: unknown[] = [];
  async submit(documents: { internalID?: string }[]): Promise<EtaSubmission> {
    this.submitted.push(...documents);
    return {
      submissionId: 'SUB1',
      accepted: documents.map((d, i) => ({
        uuid: `UUID${i}`,
        longId: `LONG${i}`,
        internalId: String(d.internalID),
      })),
      rejected: [],
    };
  }
  async status(): Promise<{ status: EtaDocumentStatus }> {
    return { status: 'Valid' };
  }
}

describe('tax invoices and the e-invoice system end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const eta = new FakeEta();

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ eta }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('issues invoices, signs them through the signing program and sends them', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { approval: 'approved' } });
    const today = cairoDay(new Date());
    const [y, m] = today.split('-').map(Number) as [number, number];
    const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      occurredAt: new Date(cairoDayStart(`${last}-15`).getTime() + 3600_000),
      lines: [
        { account: { type: 'merchant', merchantId: merchant.id }, amount: 11_400 },
        { account: { type: 'revenue' }, amount: -10_000 },
        { account: { type: 'vat_payable' }, amount: -1_400 },
      ],
    });
    expect(
      (await finance.post('/finance/invoices/prepare').send({ month: last }).expect(201)).body,
    ).toMatchObject({ created: 1 });
    const [invoice] = (await finance.get('/finance/invoices').expect(200)).body;
    expect(invoice).toMatchObject({ label: 'INV-000001', totalPiastres: 11_400 });

    // Our tax details (approvers), the signing program's key (admin only).
    await finance
      .put('/finance/company-profile')
      .send({
        legalNameAr: 'شيبلي ناو',
        taxRegistrationNumber: '123456789',
        activityCode: '5320',
        governorate: 'Cairo',
        regionCity: 'Nasr City',
        street: 'Abbas El Akkad',
        buildingNumber: '10',
        itemCodes: Object.fromEntries(
          [
            'order_fee',
            'cod_fee',
            'failed_fee',
            'receiving_fee',
            'storage_fee',
            'return_fee',
            'adjustment',
          ].map((k, i) => [k, `EG-123456789-${i}`]),
        ),
        etaEnabled: true,
      })
      .expect(200);
    await finance.post('/finance/company-profile/signer-key').expect(403);
    const signerKey = (await admin.post('/finance/company-profile/signer-key').expect(201)).body
      .key;
    expect((await finance.get('/finance/eta/readiness').expect(200)).body.ready).toBe(true);

    const signer = request(app.getHttpServer());
    await signer.get('/eta-signer/documents').set('x-signer-key', 'snsk_wrong').expect(401);
    const docs = await signer
      .get('/eta-signer/documents')
      .set('x-signer-key', signerKey)
      .expect(200);
    expect(docs.body.documents).toHaveLength(1);
    await signer
      .post('/eta-signer/signatures')
      .set('x-signer-key', signerKey)
      .send({ signatures: [{ id: docs.body.documents[0].id, signature: 'MIIGsignature' }] })
      .expect(201);
    await finance.post('/finance/eta/sync').expect(201);
    expect((await finance.get(`/finance/invoices/${invoice.id}`).expect(200)).body).toMatchObject({
      etaStatus: 'submitted',
      etaUuid: 'UUID0',
    });
    // The signed document went with its signature.
    expect(JSON.stringify(eta.submitted[0])).toContain('MIIGsignature');
    await prisma.taxInvoice.update({
      where: { id: invoice.id },
      data: { etaCheckedAt: new Date(Date.now() - 60_000) },
    });
    await finance.post('/finance/eta/sync').expect(201);
    expect((await finance.get(`/finance/invoices/${invoice.id}`).expect(200)).body.etaStatus).toBe(
      'valid',
    );

    // A credit note waits for a second person, then gets its own number.
    const note = await finance
      .post(`/finance/invoices/${invoice.id}/credit-notes`)
      .send({ amountPiastres: 5_000, reason: 'Late delivery', idempotencyKey: key() })
      .expect(201);
    expect(note.body.status).toBe('pending');
    await admin
      .post(`/finance/requests/${note.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);
    const all = (await finance.get('/finance/invoices').expect(200)).body;
    expect(all.find((i: { type: string }) => i.type === 'credit_note')).toMatchObject({
      label: 'CN-000001',
      totalPiastres: 5_700,
      original: 'INV-000001',
    });
  });
});

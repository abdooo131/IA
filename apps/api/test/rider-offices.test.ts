import type { INestApplication } from '@nestjs/common';
import { addMonths, post } from '@shiplynow/db';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

// Rider supply offices: accounting view reads, use prepares the monthly bills, manage marks
// offices and sets their rate; HR use links a rider to an office on the rider's file.

const PASSWORD = 'long-password-1';

describe('rider offices', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let officeId: string;
  let riderEmployeeId: string;
  let riderId: string;
  let storeId: string;

  const agent = async (email: string, password = PASSWORD) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const person = async (
    email: string,
    role: Parameters<typeof grantAccess>[2],
    kind: 'finance' | 'admin' = 'admin',
    storeIds: string[] = [],
  ) => {
    const user = await createUser(prisma, { email, password: PASSWORD, role: kind });
    await grantAccess(prisma, user.id, role, storeIds);
    return agent(email);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin' } });
    officeId = (
      await prisma.supplier.create({
        data: { name: 'Fast Riders Office', taxId: '111-222-333', createdById: admin.id },
      })
    ).id;
    const rider = await prisma.rider.findFirstOrThrow({
      where: { user: { email: 'rider.newcairo@shiplynow.local' } },
      include: { user: { include: { employee: true } } },
    });
    riderId = rider.id;
    storeId = rider.darkStoreId;
    riderEmployeeId = rider.user.employee!.id;
  });

  it('lets accounting manage mark an office and set its rate; use and view cannot', async () => {
    const viewer = await person('viewer@t.eg', 'accountant', 'finance');
    const officer = await person('officer@t.eg', 'finance_officer', 'finance');
    const manager = await person('manager@t.eg', 'finance_manager', 'finance');
    const body = { isRiderOffice: true, commissionBp: 2000 };
    await viewer.patch(`/finance/rider-offices/${officeId}`).send(body).expect(403);
    await officer.patch(`/finance/rider-offices/${officeId}`).send(body).expect(403);
    await manager
      .patch(`/finance/rider-offices/${officeId}`)
      .send({ commissionBp: 10_001 })
      .expect(400);
    const saved = await manager.patch(`/finance/rider-offices/${officeId}`).send(body).expect(200);
    expect(saved.body).toMatchObject({ isRiderOffice: true, commissionBp: 2000 });

    const list = await viewer.get('/finance/rider-offices').expect(200);
    expect(list.body.rows).toEqual([
      expect.objectContaining({ id: officeId, commissionBp: 2000, riders: 0 }),
    ]);
    await viewer.get(`/finance/rider-offices/${officeId}`).expect(200);
    await viewer.get('/finance/rider-offices?month=2026-13').expect(400);
    const suppliers = await viewer.get('/finance/suppliers').expect(200);
    expect(suppliers.body.find((s: { id: string }) => s.id === officeId)).toMatchObject({
      isRiderOffice: true,
      commissionBp: 2000,
    });

    // People without accounting never see the offices.
    const hr = await person('hr@t.eg', 'hr_officer');
    await hr.get('/finance/rider-offices').expect(403);
  });

  it('lets HR use link a rider to an office, and only to a rider office', async () => {
    await prisma.supplier.update({
      where: { id: officeId },
      data: { isRiderOffice: true, commissionBp: 2000 },
    });
    const plain = await prisma.supplier.create({
      data: {
        name: 'Staffing Co',
        createdById: (await prisma.user.findFirstOrThrow({ where: { role: 'admin' } })).id,
      },
    });
    const storeManager = await person('sm@t.eg', 'store_manager', 'admin', [storeId]);
    const hr = await person('hr@t.eg', 'hr_officer');
    const link = { employment: 'outsourced', staffingSupplierId: officeId };
    await storeManager.put(`/hr/employees/${riderEmployeeId}/employment`).send(link).expect(403);
    const refused = await hr
      .put(`/hr/employees/${riderEmployeeId}/employment`)
      .send({ employment: 'outsourced', staffingSupplierId: plain.id })
      .expect(400);
    expect(refused.body.error).toBe('rider_office_required');
    await hr.put(`/hr/employees/${riderEmployeeId}/employment`).send(link).expect(200);
    const companies = await hr.get('/hr/staffing-companies').expect(200);
    expect(companies.body.find((c: { id: string }) => c.id === officeId)).toEqual({
      id: officeId,
      name: 'Fast Riders Office',
      isRiderOffice: true,
    });
    const file = await hr.get(`/hr/employees/${riderEmployeeId}`).expect(200);
    expect(file.body.staffingSupplier).toMatchObject({ id: officeId, isRiderOffice: true });

    const detail = await (
      await person('viewer@t.eg', 'accountant', 'finance')
    )
      .get(`/finance/rider-offices/${officeId}`)
      .expect(200);
    expect(detail.body.riders).toEqual([expect.objectContaining({ riderId })]);
  });

  it('lets accounting use prepare a finished month once; view cannot', async () => {
    await prisma.supplier.update({
      where: { id: officeId },
      data: { isRiderOffice: true, commissionBp: 2000 },
    });
    await prisma.employee.update({
      where: { id: riderEmployeeId },
      data: { employment: 'outsourced', staffingSupplierId: officeId },
    });
    const last = addMonths(cairoDay(new Date()).slice(0, 7), -1);
    const at = new Date(`${last}-15T10:00:00Z`);
    // A commission booked last month, as a delivery books it.
    await post(prisma, {
      kind: 'rider_office_commission',
      idempotencyKey: 'test:office:1',
      occurredAt: at,
      riderId,
      data: { supplierId: officeId, riderId, payPiastres: 30_000, commissionBp: 2000 },
      lines: [
        { account: { type: 'rider_office_commission' }, amount: 6000 },
        { account: { type: 'rider_office_accrued' }, amount: -6000 },
      ],
    });
    const viewer = await person('viewer@t.eg', 'accountant', 'finance');
    const officer = await person('officer@t.eg', 'finance_officer', 'finance');
    await viewer.post('/finance/rider-offices/prepare-bills').send({ month: last }).expect(403);
    const thisMonth = cairoDay(new Date()).slice(0, 7);
    const early = await officer
      .post('/finance/rider-offices/prepare-bills')
      .send({ month: thisMonth })
      .expect(400);
    expect(early.body.error).toBe('month_not_over');
    const done = await officer
      .post('/finance/rider-offices/prepare-bills')
      .send({ month: last })
      .expect(201);
    expect(done.body.offices).toEqual([
      expect.objectContaining({
        supplierId: officeId,
        status: 'billed',
        commissionPiastres: 6000,
        billLabel: expect.stringMatching(/^BILL-\d{6}$/),
      }),
    ]);
    const again = await officer
      .post('/finance/rider-offices/prepare-bills')
      .send({ month: last, supplierId: officeId })
      .expect(201);
    expect(again.body.offices[0].status).toBe('already_billed');
    expect(await prisma.bill.count({ where: { supplierId: officeId } })).toBe(1);
    const bills = await officer.get(`/finance/bills?supplierId=${officeId}`).expect(200);
    expect(bills.body[0]).toMatchObject({ officeMonth: last, netPiastres: 6000 });
    await officer
      .post(`/finance/bills/${bills.body[0].id}/cancel`)
      .send({ reason: 'entered by mistake' })
      .expect(409);
  });
});

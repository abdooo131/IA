import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginThrottleService } from '../src/auth/login-throttle.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const application = {
  businessName: 'Nile Beauty',
  contactName: 'Hana Fathy',
  email: 'hana@nile.example',
  phone: '0101 999 8877',
  password: 'a-long-password-1',
  shopDomain: 'Nile-Beauty.myshopify.com',
};

describe('merchant self sign up end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    // Each test starts with no sign ups counted.
    const throttle = app.get(LoginThrottleService);
    (throttle as unknown as { failures: Map<string, number[]> }).failures.clear();
    await resetAndSeed(prisma);
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  it('applies, waits for admin, then signs in and sees the onboarding steps', async () => {
    const web = request(app.getHttpServer());
    await web
      .post('/auth/signup')
      .send({ ...application, phone: '123' })
      .expect(400);
    await web.post('/auth/signup').send(application).expect(201);
    await web.post('/auth/signup').send(application).expect(409);

    const pending = await login(application.email, application.password).expect(403);
    expect(pending.body.error).toBe('account_pending');
    // A wrong password still says only that the credentials are wrong.
    await login(application.email, 'wrong-password-1').expect(401);

    const admin = request.agent(app.getHttpServer());
    await admin
      .post('/auth/login')
      .send({ email: 'admin@test.eg', password: 'admin-password-1' })
      .expect(200);
    const merchants = await admin.get('/admin/merchants').expect(200);
    const mine = merchants.body.find((m: { name: string }) => m.name === 'Nile Beauty');
    expect(mine).toMatchObject({ approval: 'pending', isActive: false });
    await admin.post(`/admin/merchants/${mine.id}/approve`).expect(201);

    const merchant = request.agent(app.getHttpServer());
    await merchant
      .post('/auth/login')
      .send({ email: application.email, password: application.password })
      .expect(200);
    const steps = await merchant.get('/merchant/onboarding').expect(200);
    expect(steps.body).toEqual({ products: false, price: false, shopify: false, shipment: false });
  });

  it('tells a rejected applicant, and limits sign ups per address', async () => {
    const web = request(app.getHttpServer());
    await web.post('/auth/signup').send(application).expect(201);
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { name: 'Nile Beauty' } });
    const admin = request.agent(app.getHttpServer());
    await admin
      .post('/auth/login')
      .send({ email: 'admin@test.eg', password: 'admin-password-1' })
      .expect(200);
    await admin.post(`/admin/merchants/${merchant.id}/reject`).send({}).expect(400);
    await admin
      .post(`/admin/merchants/${merchant.id}/reject`)
      .send({ reason: 'Outside our zones' })
      .expect(201);
    const rejected = await login(application.email, application.password).expect(403);
    expect(rejected.body.error).toBe('account_rejected');

    for (let i = 1; i < 5; i++)
      await web
        .post('/auth/signup')
        .send({ ...application, email: `x${i}@nile.example`, phone: `0101999880${i}` })
        .expect(201);
    await web
      .post('/auth/signup')
      .send({ ...application, email: 'x9@nile.example', phone: '01019998809' })
      .expect(429);
  });
});

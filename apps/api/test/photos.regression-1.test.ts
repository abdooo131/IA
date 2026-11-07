// Regression: ISSUE-004 — any bytes were accepted as a proof photo
// Found by /qa on 2026-10-28
// Report: docs/QA_REPORT.md
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

describe('proof photo uploads', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staff: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
    staff = request.agent(app.getHttpServer());
    await staff
      .post('/auth/login')
      .send({ email: 'staff.newcairo@shiplynow.local', password: 'demo-password-1' })
      .expect(200);
  });

  const upload = (type: string, body: Buffer) =>
    staff.post('/photos?kind=pack').set('content-type', type).send(body);

  it('takes real images of the declared type', async () => {
    await upload('image/jpeg', JPEG).expect(201);
    await upload('image/png', PNG).expect(201);
    await upload('image/webp', WEBP).expect(201);
  });

  it('refuses bytes that are not the image they claim to be', async () => {
    const text = await upload('image/jpeg', Buffer.from('this is not a jpeg')).expect(400);
    expect(text.body.error).toBe('photo_not_image');
    await upload('image/png', JPEG).expect(400);
    await upload('image/jpeg', Buffer.from('<svg onload=alert(1)>')).expect(400);
    expect(await prisma.photo.count()).toBe(0);
  });
});

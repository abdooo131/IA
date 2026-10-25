import type { INestApplication } from '@nestjs/common';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { cookieValue, createTestApp, createUser, resetDatabase } from './helpers';

const ADMIN = { email: 'admin@test.eg', password: 'admin-password-1', role: 'admin' as const };
const RIDER = { email: 'rider@test.eg', password: 'rider-password-1', role: 'rider' as const };

describe('auth', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, ADMIN);
    await createUser(prisma, RIDER);
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  describe('POST /auth/login', () => {
    it('signs in with the right password and sets httpOnly cookies', async () => {
      const res = await login('  ADMIN@test.eg ', ADMIN.password).expect(200);

      expect(res.body.user).toMatchObject({ email: ADMIN.email, role: 'admin' });
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.expiresIn).toBe(900);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const access = cookies.find((c) => c.startsWith(`${ACCESS_TOKEN_COOKIE}=`));
      const refresh = cookies.find((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE}=`));
      expect(access).toMatch(/HttpOnly/);
      expect(access).toMatch(/SameSite=Lax/);
      expect(refresh).toMatch(/HttpOnly/);
    });

    it('stores only a hash of the refresh token', async () => {
      const res = await login(ADMIN.email, ADMIN.password).expect(200);
      const raw = cookieValue(res.headers['set-cookie'], REFRESH_TOKEN_COOKIE)!;
      const rows = await prisma.refreshToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).not.toBe(raw);
      expect(rows[0]!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects a wrong password and an unknown email with the same error', async () => {
      const wrong = await login(ADMIN.email, 'nope').expect(401);
      const unknown = await login('ghost@test.eg', 'nope').expect(401);
      expect(wrong.body.error).toBe('invalid_credentials');
      expect(unknown.body.error).toBe('invalid_credentials');
    });

    it('rejects a deactivated user', async () => {
      await createUser(prisma, {
        email: 'old@test.eg',
        password: 'old-password-1',
        role: 'rider',
        isActive: false,
      });
      await login('old@test.eg', 'old-password-1').expect(401);
    });

    it('validates the body', async () => {
      const res = await login('not-an-email', '').expect(400);
      expect(res.body.error).toBe('validation_failed');
    });
  });

  describe('GET /auth/me', () => {
    it('requires a token', async () => {
      const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
      expect(res.body.error).toBe('unauthenticated');
    });

    it('accepts the access cookie', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/auth/login').send(ADMIN).expect(200);
      const res = await agent.get('/auth/me').expect(200);
      expect(res.body.user.email).toBe(ADMIN.email);
    });

    it('accepts a bearer token', async () => {
      const { body } = await login(RIDER.email, RIDER.password).expect(200);
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      expect(res.body.user.role).toBe('rider');
    });

    it('rejects a tampered token', async () => {
      const { body } = await login(RIDER.email, RIDER.password).expect(200);
      const [header, payload, signature] = (body.accessToken as string).split('.');
      const forged = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
          role: 'admin',
        }),
      ).toString('base64url');
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${header}.${forged}.${signature}`)
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token', async () => {
      const first = await login(ADMIN.email, ADMIN.password).expect(200);
      const oldToken = cookieValue(first.headers['set-cookie'], REFRESH_TOKEN_COOKIE)!;

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${oldToken}`)
        .expect(200);
      const newToken = cookieValue(res.headers['set-cookie'], REFRESH_TOKEN_COOKIE)!;

      expect(newToken).toBeTruthy();
      expect(newToken).not.toBe(oldToken);
      expect(res.body.user.email).toBe(ADMIN.email);
    });

    it('treats reuse of a rotated token as theft and revokes every session', async () => {
      const first = await login(ADMIN.email, ADMIN.password).expect(200);
      const oldToken = cookieValue(first.headers['set-cookie'], REFRESH_TOKEN_COOKIE)!;
      const rotated = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${oldToken}`)
        .expect(200);
      const newToken = cookieValue(rotated.headers['set-cookie'], REFRESH_TOKEN_COOKIE)!;

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${oldToken}`)
        .expect(401);
      // The legitimate new token is revoked too.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${newToken}`)
        .expect(401);
    });

    it('rejects an expired refresh token', async () => {
      const first = await login(ADMIN.email, ADMIN.password).expect(200);
      const token = cookieValue(first.headers['set-cookie'], REFRESH_TOKEN_COOKIE)!;
      await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${token}`)
        .expect(401);
    });

    it('rejects a missing token', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token and clears cookies', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/auth/login').send(ADMIN).expect(200);
      await agent.post('/auth/logout').expect(204);
      await agent.post('/auth/refresh').expect(401);
      const rows = await prisma.refreshToken.findMany();
      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    });
  });

  describe('roles', () => {
    it('lets an admin list users', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/auth/login').send(ADMIN).expect(200);
      const res = await agent.get('/users').expect(200);
      expect(res.body.map((u: { email: string }) => u.email).sort()).toEqual(
        [ADMIN.email, RIDER.email].sort(),
      );
    });

    it('forbids a rider from listing users', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/auth/login').send(RIDER).expect(200);
      const res = await agent.get('/users').expect(403);
      expect(res.body.error).toBe('forbidden');
    });
  });

  describe('GET /health', () => {
    it('is public and reports the database', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toEqual({ status: 'ok', database: 'up' });
    });
  });
});

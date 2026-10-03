import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

export const PASSWORD = 'Shiply@2026';

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

export async function login(app: INestApplication, email: string, appName: string) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD, app: appName });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { accessToken: string; refreshToken: string; user: { id: string; merchantId: string | null } };
}

export function api(app: INestApplication, token: string) {
  const srv = app.getHttpServer();
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (u: string) => auth(request(srv).get(`/api${u}`)),
    post: (u: string, body?: object) => auth(request(srv).post(`/api${u}`)).send(body),
    patch: (u: string, body?: object) => auth(request(srv).patch(`/api${u}`)).send(body),
    put: (u: string, body?: object) => auth(request(srv).put(`/api${u}`)).send(body),
    upload: (u: string, field: string, content: string, name: string) =>
      auth(request(srv).post(`/api${u}`)).attach(field, Buffer.from(content), name),
  };
}

export const sampleOrder = {
  customerName: 'Test Customer',
  customerPhone: '01012345678',
  governorateCode: 'CAI',
  area: 'Maadi',
  addressLine: '10 Road 9, Maadi, Cairo',
  codAmount: 45000,
  size: 'SMALL_MEDIUM',
  type: 'DELIVER',
  allowOpenPackage: false,
};

import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppErrorFilter } from '../src/common/domain-error.filter';
import { ErrorReporter } from '../src/common/error-reporter';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

describe('error alerts', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('raises one admin alert per problem and counts repeats until it is handled', async () => {
    const reporter = app.get(ErrorReporter);
    await reporter.report('job: SLA check', new Error('connection   reset'));
    await reporter.report('job: SLA check', new Error('connection reset'));
    await reporter.report('job: storage charge', new Error('deadlock'));
    const alerts = await prisma.alert.findMany({
      where: { type: 'server_error' },
      orderBy: { createdAt: 'asc' },
    });
    expect(alerts.map((a) => a.data)).toEqual([
      expect.objectContaining({ source: 'job: SLA check', message: 'connection reset', count: 2 }),
      expect.objectContaining({ source: 'job: storage charge', count: 1 }),
    ]);

    // Once admin marks it handled, the next failure opens a new alert.
    const admin = request.agent(app.getHttpServer());
    await admin
      .post('/auth/login')
      .send({ email: 'admin@test.eg', password: 'admin-password-1' })
      .expect(200);
    const list = await admin.get('/admin/alerts').expect(200);
    const first = list.body.find((a: { type: string }) => a.type === 'server_error');
    expect(first).toBeTruthy();
    await prisma.alert.update({ where: { id: alerts[0]!.id }, data: { resolvedAt: new Date() } });
    await reporter.report('job: SLA check', new Error('connection reset'));
    expect(await prisma.alert.count({ where: { type: 'server_error' } })).toBe(3);
  });

  it('answers 500 for unexpected errors and reports them, without the query string', async () => {
    const reported: { source: string; error: unknown }[] = [];
    const filter = new AppErrorFilter(app.get(HttpAdapterHost).httpAdapter, {
      report: async (source: string, error: unknown) => {
        reported.push({ source, error });
      },
    } as unknown as ErrorReporter);
    const sent: { status?: number; body?: unknown } = {};
    const res = {
      headersSent: false,
      getHeader: () => undefined,
      setHeader: () => undefined,
      send(body: unknown) {
        sent.body = body;
        return this;
      },
      status(code: number) {
        sent.status = code;
        return this;
      },
      json(body: unknown) {
        sent.body = body;
        return this;
      },
    };
    const host = {
      getType: () => 'http',
      getArgs: () => [{ method: 'POST', path: '/rider/x', url: '/rider/x?code=123' }, res],
      getArgByIndex: (i: number) =>
        i === 0 ? { method: 'POST', path: '/rider/x', url: '/rider/x?code=123' } : res,
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/rider/x', url: '/rider/x?code=123' }),
        getResponse: () => res,
      }),
    };
    // A refused business rule is not a server problem.
    const { DomainError } = await import('@shiplynow/db');
    filter.catch(new DomainError('order_not_cancellable', 409), host as never);
    expect(sent).toEqual({ status: 409, body: { error: 'order_not_cancellable' } });
    expect(reported).toEqual([]);

    // Proof through a real request: an HTTP error stays as it is and raises nothing.
    await request(app.getHttpServer()).get('/admin/alerts').expect(401);
    expect(await prisma.alert.count({ where: { type: 'server_error' } })).toBe(0);

    filter.catch(new TypeError('cannot read x of undefined'), host as never);
    expect(reported).toEqual([{ source: 'POST /rider/x', error: expect.any(TypeError) }]);
    expect(sent.status).toBe(500);
  });
});

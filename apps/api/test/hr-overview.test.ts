import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const PASSWORD = 'team-password-1';
const NOW = new Date('2026-11-07T10:00:00Z');

/** HR phase 1 (docs/HR.md "Phase 1 as built"): the HR home, the employee list and the file. */
describe('hr phase 1', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let admin: ReturnType<typeof request.agent>;
  const clock = new FixedClock(NOW);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const member = async (email: string, jobRole: string, extra: Record<string, unknown> = {}) => {
    await admin
      .post('/admin/users')
      .send({ email, name: email, role: 'admin', jobRole, password: PASSWORD, ...extra })
      .expect(201);
    return agent(email, PASSWORD);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(NOW);
    ({ stores } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  it('gives HR one home of what needs attention, inside the person store scope', async () => {
    const home = (await admin.get('/hr/overview').expect(200)).body;
    expect(home.day).toBe('2026-11-07');
    expect(home.headcount.total).toBe(6);
    expect(home.headcount.byEmployment).toEqual({ employee: 6, outsourced: 0 });
    expect(home.documents.people).toBeGreaterThan(0);
    expect(home).toHaveProperty('now.in');
    expect(home).toHaveProperty('inbox.total');
    expect(home).toHaveProperty('checklists.onboarding');

    // A store manager has HR view of their store only (their rules unchanged).
    const lead = await member('lead.maadi@shiply.eg', 'store_manager', {
      storeIds: [stores.get('MAA')],
    });
    const mine = (await lead.get('/hr/overview').expect(200)).body;
    expect(mine.headcount.total).toBe(2);
    const list = (await lead.get('/hr/directory').expect(200)).body;
    expect(list.total).toBe(2);
    expect(
      list.rows.every((r: { homeStore: { id: string } }) => r.homeStore.id === stores.get('MAA')),
    ).toBe(true);
    // Store staff and riders have no HR home.
    const staff = await agent('staff.newcairo@shiplynow.local');
    expect((await staff.get('/hr/overview').expect(403)).body.error).toBe('no_access');
    await staff.get('/hr/directory').expect(403);
  });

  it('lists people with flags, a flag filter, sort, pages and CSV', async () => {
    const all = (await admin.get('/hr/directory').expect(200)).body;
    expect(all).toMatchObject({ total: 6, page: 1, pages: 1 });
    expect(all.rows[0]).toHaveProperty('flags');
    expect(all.flagCounts.missing_documents).toBeGreaterThan(0);
    const flagged = (await admin.get('/hr/directory?flag=missing_documents').expect(200)).body;
    expect(flagged.total).toBe(all.flagCounts.missing_documents);
    expect(
      flagged.rows.every((r: { flags: string[] }) => r.flags.includes('missing_documents')),
    ).toBe(true);
    const desc = (await admin.get('/hr/directory?sort=code&dir=desc').expect(200)).body;
    const codes = desc.rows.map((r: { code: string }) => r.code);
    expect(codes).toEqual([...codes].sort().reverse());
    // An unknown flag or sort is ignored rather than refused.
    expect((await admin.get('/hr/directory?flag=nope&sort=nope').expect(200)).body.total).toBe(6);
    const csv = await admin.get('/hr/employees.csv?flag=missing_documents').expect(200);
    const lines = csv.text.trim().split(/\r?\n/);
    expect(lines[0]).toContain('flags');
    expect(lines).toHaveLength(flagged.total + 1);
  });

  it('shows how complete a file is and what is missing', async () => {
    const rider = await prisma.employee.findFirstOrThrow({
      where: { user: { email: 'rider.maadi@shiplynow.local' } },
    });
    const file = (await admin.get(`/hr/employees/${rider.id}`).expect(200)).body;
    expect(file.fileCompleteness.percent).toBeLessThan(100);
    expect(file.fileCompleteness.missing).toContainEqual({ kind: 'field', field: 'photo' });
    // The owner has the salaries switch: the bank account counts for an employee.
    expect(file.fileCompleteness.missing).toContainEqual({ kind: 'field', field: 'bankAccount' });
    expect(file.flags).toContain('missing_documents');
    const hr = await member('hr@shiply.eg', 'hr_officer');
    const seen = (await hr.get(`/hr/employees/${rider.id}`).expect(200)).body;
    expect(seen.fileCompleteness.missing).not.toContainEqual({
      kind: 'field',
      field: 'bankAccount',
    });
  });
});

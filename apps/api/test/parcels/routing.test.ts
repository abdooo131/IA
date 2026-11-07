// Routing and coverage: a parcel goes merchant -> nearest sorting facility -> (up to two
// facilities in between, along the truck routes) -> the facility feeding the customer's hub ->
// that hub. The plan is stored on the parcel. We pick up and deliver only where a hub serves.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createNetworkApp } from './setup-db';

process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
let core: any;
let admin: ReturnType<typeof request.agent>;
let merchant: ReturnType<typeof request.agent>;
let merchantId = '';
const hubs: Record<string, string> = {};

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}
const parcel = (governorateCode: string) => merchant.post('/parcels/merchant/shipments').send({ customerName: 'Mona Adel', customerPhone: '01012345678', address: '12 Some St', governorateCode, codAmount: 10000 });

beforeAll(async () => {
    const { PrismaService } = await import('../../src/parcels/common/prisma.service');
  const { ShipmentsCore } = await import('../../src/parcels/core/shipments.core');
  app = await createNetworkApp();
  prisma = app.get(PrismaService);
  core = app.get(ShipmentsCore);
  admin = request.agent(app.getHttpServer());
  merchant = request.agent(app.getHttpServer());
  await ok(admin.post('/auth/login').send({ email: 'admin@shiply.local', password: 'admin12345' }));
  await ok(merchant.post('/auth/login').send({ email: 'merchant@evechantelle.example', password: 'demo123456' }));
  merchantId = (await ok(merchant.get('/parcels/auth/me'))).merchantId;
  for (const h of await ok(admin.get('/parcels/admin/hubs'))) hubs[h.code] = h.id;
});

afterAll(async () => {
  await app?.close();
});

describe('routing', () => {
  it('plans merchant facility to last mile hub, through the facility that feeds it, and stores the plan', async () => {
    const near = await ok(admin.get(`/parcels/admin/route-preview?merchantId=${merchantId}&governorateCode=EG-GZ`));
    expect(near.ok).toBe(true);
    expect(near.steps.map((s: any) => s.code)).toEqual(['OBR', 'GIZ']);
    expect(near.steps[0].kind).toBe('PICKUP_FACILITY');
    const far = await ok(admin.get(`/parcels/admin/route-preview?merchantId=${merchantId}&governorateCode=EG-ALX`));
    expect(far.steps.map((s: any) => s.code)).toEqual(['OBR', 'ALXSF', 'ALX']);
    expect(far.transfers).toBe(0);
    const p = await ok(parcel('EG-ALX'), 201);
    expect(p.route).toEqual(['OBR', 'ALXSF', 'ALX']);
  });

  it('goes through facilities in between when trucks only run between neighbours', async () => {
    const tnt = await ok(admin.post('/parcels/admin/hubs').send({ code: 'TNTSF', name: 'Tanta Sorting Center', isSorting: true, lat: 30.79, lng: 31.0 }), 201);
    for (const l of await ok(admin.get('/parcels/admin/line-hauls'))) await ok(admin.delete(`/parcels/admin/line-hauls/${l.id}`));
    await ok(admin.post('/parcels/admin/line-hauls').send({ fromId: hubs.OBR, toId: tnt.id }), 201);
    const links = await ok(admin.post('/parcels/admin/line-hauls').send({ fromId: tnt.id, toId: hubs.ALXSF, hours: 4 }), 201);
    expect(links.length).toBe(4); // both ways each
    expect((await admin.post('/parcels/admin/line-hauls').send({ fromId: hubs.OBR, toId: hubs.GIZ })).status).toBe(422); // a hub is not a facility

    const r = await ok(admin.get(`/parcels/admin/route-preview?merchantId=${merchantId}&governorateCode=EG-ALX`));
    expect(r.steps.map((s: any) => s.code)).toEqual(['OBR', 'TNTSF', 'ALXSF', 'ALX']);
    expect(r.transfers).toBe(1);
    const p = await ok(parcel('EG-ALX'), 201);
    expect(p.route).toEqual(['OBR', 'TNTSF', 'ALXSF', 'ALX']);

    // Moving it on: each facility sends it to the next one on the plan.
    const at = (code: string) => core.nextStep(prisma, { ...p, status: 'AT_INBOUND', currentHubId: hubs[code] ?? tnt.id });
    expect((await at('OBR')).hubCode).toBe('TNTSF');
    expect((await core.nextStep(prisma, { ...p, status: 'AT_INBOUND', currentHubId: tnt.id })).hubCode).toBe('ALXSF');
    expect((await at('ALXSF')).hubCode).toBe('ALX');
    expect((await at('ALX')).kind).toBe('DELIVER');
  });

  it('refuses a parcel no chain of trucks can carry', async () => {
    for (const l of await ok(admin.get('/parcels/admin/line-hauls'))) if (l.from.code === 'TNTSF' && l.to.code === 'ALXSF') await ok(admin.delete(`/parcels/admin/line-hauls/${l.id}`));
    const r = await ok(admin.get(`/parcels/admin/route-preview?merchantId=${merchantId}&governorateCode=EG-ALX`));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('No truck route');
    const res = await parcel('EG-ALX');
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('No truck route');
    // Inside its own facility's area nothing changes.
    expect((await ok(parcel('EG-GZ'), 201)).route).toEqual(['OBR', 'GIZ']);
  });

  it('delivers and picks up only where a hub serves', async () => {
    const cov = await ok(admin.get('/parcels/admin/coverage'));
    expect(cov.find((g: any) => g.code === 'EG-GZ').served).toBe(true);
    await prisma.governorate.update({ where: { code: 'EG-SHG' }, data: { hubId: null } });
    const out = await parcel('EG-SHG');
    expect(out.status).toBe(422);
    expect(out.body.message).toContain('do not deliver');

    // The merchant is in Cairo: if Cairo is not served, we cannot pick up from them.
    const cai = await prisma.governorate.findUnique({ where: { code: 'EG-C' } });
    await prisma.governorate.update({ where: { code: 'EG-C' }, data: { hubId: null } });
    await prisma.networkArea.updateMany({ where: { governorateCode: 'EG-C' }, data: { hubId: null } });
    const pick = await parcel('EG-GZ');
    expect(pick.status).toBe(422);
    expect(pick.body.message).toBe('We do not pick up from your area yet');
    await prisma.governorate.update({ where: { code: 'EG-C' }, data: { hubId: cai.hubId } });
  });
});

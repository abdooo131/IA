import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { ComplianceService } from '../src/agents/compliance.service';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
let owner: string[];
let agentId: string;
let personId: string;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  agentId = (await post('/agents', { code: 'FAST', name: 'Fast', nameAr: 'فاست', contactName: 'Adel', phone: '01000000001', services: ['shiply'] })).body.id;
  const p = (await post('/agents/people', { agentId, role: 'delivery', name: 'Tamer', nameAr: 'تامر', mobile: '01234567890', password: 'tamer-pass-1' })).body;
  personId = p.id;
  await db.person.update({ where: { id: personId }, data: { status: 'approved' } });
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object) => http().post(url).set('Cookie', owner).send(body);
const check = () => app.get(ComplianceService).check(new Date('2026-11-09T10:00:00Z'));
const person = () => db.person.findUniqueOrThrow({ where: { id: personId } });

describe('compliance', () => {
  it('blocks a person without his documents and unblocks him once they are valid', async () => {
    await check();
    expect(await person()).toMatchObject({ blocked: true });
    expect((await person()).blockedReason).toContain('driving_licence');
    await post('/agents/documents', { personId, kind: 'national_id', number: '29001011234567' });
    await post('/agents/documents', { personId, kind: 'driving_licence', number: 'DL-1', expiresAt: '2027-11-01' });
    await check();
    expect(await person()).toMatchObject({ blocked: false, blockedReason: null });
  });

  it('blocks him again when his vehicle insurance expired', async () => {
    await post('/agents/documents', { personId, kind: 'national_id', number: '29001011234567' });
    await post('/agents/documents', { personId, kind: 'driving_licence', number: 'DL-1', expiresAt: '2027-11-01' });
    const v = (await post('/agents/vehicles', { agentId, plate: 'س ط ع 123', type: 'motorbike', personId })).body;
    await post('/agents/documents', { vehicleId: v.id, kind: 'vehicle_licence', number: 'VL-1', expiresAt: '2027-01-01' });
    await post('/agents/documents', { vehicleId: v.id, kind: 'insurance', number: 'IN-1', expiresAt: '2026-10-01' });
    await check();
    expect((await person()).blockedReason).toContain('insurance');
  });

  it('lists documents expiring soon and counts them on Home', async () => {
    await post('/agents/documents', { personId, kind: 'driving_licence', number: 'DL-1', expiresAt: '2026-11-20' });
    const list = (await http().get('/agents/compliance').set('Cookie', owner)).body;
    expect(list.expiring).toEqual([expect.objectContaining({ personId, kind: 'driving_licence' })]);
    const home = (await http().get('/me/home').set('Cookie', owner)).body;
    expect(home.attention).toContainEqual(expect.objectContaining({ app: 'fleet', text: 'home.documentsExpiring', values: { count: 1 } }));
  });

  it('refuses the same plate written with spaces', async () => {
    expect((await post('/agents/vehicles', { agentId, plate: 'ABC 123', type: 'car' })).body.plate).toBe('ABC123');
    const again = await post('/agents/vehicles', { agentId, plate: 'abc  123', type: 'car' });
    expect([again.status, again.body.error]).toEqual([409, 'plate_taken']);
  });
});

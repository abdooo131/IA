import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { LocationService } from '../src/location';
import { answerFromGoogle, type GeoAnswer, type Geocoder } from '../src/location/geocoder/geocoder';
import { createApp } from '../src/app';
import { db, resetDb } from './helpers';

/** A fake Google: answers from this table and counts its calls. */
const answers = new Map<string, GeoAnswer | null>();
let calls = 0;
let down = false;
const fake: Geocoder = {
  async lookup(text) {
    calls++;
    if (down) throw new Error('Google is down');
    return answers.get(text) ?? null;
  },
};

let app: INestApplication;
let location: LocationService;
const UNCLEAR = 'عند البنك الكبير';
const maadi: GeoAnswer = { lat: 29.96, lng: 31.25, names: ['المعادي', 'القاهرة'], precise: true };

beforeEach(async () => {
  await resetDb();
  answers.clear();
  calls = 0;
  down = false;
  if (!app) {
    app = await createApp(db, { geocoder: fake });
    await app.init();
  }
  location = app.get(LocationService);
  await db.setting.create({ data: { key: 'location.geocoder_enabled', value: true } });
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const resolve = (text: string, refId = 'p1') =>
  db.$transaction((tx) => location.resolve(tx, { service: 'shiply', refType: 'parcel', refId, text }));

describe('Google Maps step', () => {
  it('places what the engine could not, keeps the point, and pays once per address', async () => {
    answers.set(UNCLEAR, maadi);
    const r = await resolve(UNCLEAR);
    expect(r).toMatchObject({ method: 'geocoder', placeId: 'maadi', status: 'likely' });
    expect(await db.addressDecision.findUniqueOrThrow({ where: { id: r.decisionId } })).toMatchObject({ lat: 29.96, lng: 31.25 });
    await resolve(UNCLEAR, 'p2');
    expect(calls).toBe(1);
  });

  it('queues an imprecise answer but keeps its point as a hint', async () => {
    answers.set(UNCLEAR, { ...maadi, precise: false });
    const r = await resolve(UNCLEAR);
    expect(r.status).not.toBe('likely');
    expect(r.placeId).toBeNull();
    expect((await db.addressDecision.findUniqueOrThrow({ where: { id: r.decisionId } })).lat).toBe(29.96);
  });

  it('queues an answer naming an area we do not know', async () => {
    answers.set(UNCLEAR, { ...maadi, names: ['مكان غير معروف'] });
    expect((await resolve(UNCLEAR)).placeId).toBeNull();
  });

  it('never calls Google when switched off or over the monthly cap', async () => {
    answers.set(UNCLEAR, maadi);
    await db.setting.update({ where: { key: 'location.geocoder_enabled' }, data: { value: false } });
    await resolve(UNCLEAR);
    expect(calls).toBe(0);
    await db.setting.update({ where: { key: 'location.geocoder_enabled' }, data: { value: true } });
    await db.setting.create({ data: { key: 'location.geocoder_monthly_cap', value: 0 } });
    await resolve(UNCLEAR, 'p2');
    expect(calls).toBe(0);
  });

  it('never calls Google for an address the engine already placed', async () => {
    await resolve('المعادي الجديدة');
    expect(calls).toBe(0);
  });

  it('asks again after Google was down, instead of remembering the failure', async () => {
    answers.set(UNCLEAR, maadi);
    down = true;
    expect((await resolve(UNCLEAR)).placeId).toBeNull();
    down = false;
    expect((await resolve(UNCLEAR, 'p2')).placeId).toBe('maadi');
  });

  it('reads a Google answer in its documented format', () => {
    const sample = {
      status: 'OK',
      results: [
        {
          partial_match: false,
          geometry: { location: { lat: 30.05, lng: 31.33 }, location_type: 'ROOFTOP' },
          address_components: [
            { long_name: '12', types: ['street_number'] },
            { long_name: 'عباس العقاد', types: ['route'] },
            { long_name: 'المنطقة السادسة', types: ['sublocality_level_1', 'sublocality', 'political'] },
            { long_name: 'مدينة نصر', types: ['administrative_area_level_2', 'political'] },
            { long_name: 'محافظة القاهرة', types: ['administrative_area_level_1', 'political'] },
            { long_name: 'مصر', types: ['country', 'political'] },
          ],
        },
      ],
    };
    expect(answerFromGoogle(sample)).toEqual({ lat: 30.05, lng: 31.33, names: ['عباس العقاد', 'المنطقة السادسة', 'مدينة نصر', 'محافظة القاهرة'], precise: true });
    expect(answerFromGoogle({ status: 'ZERO_RESULTS', results: [] })).toBeNull();
    expect(answerFromGoogle({ ...sample, results: [{ ...sample.results[0]!, partial_match: true }] })!.precise).toBe(false);
  });
});

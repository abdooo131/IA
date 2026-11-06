import { describe, expect, it } from 'vitest';
import {
  coverageQuerySchema,
  parsePinAttribute,
  weekHoursSchema,
  zonePolygonSchema,
} from './coverage';

describe('coverageQuerySchema', () => {
  it('accepts a point from query strings or an address', () => {
    expect(coverageQuerySchema.parse({ lat: '30.03', lng: '31.47' })).toEqual({
      lat: 30.03,
      lng: 31.47,
    });
    expect(coverageQuerySchema.parse({ address: ' 90th Street ' })).toEqual({
      address: '90th Street',
    });
    expect(coverageQuerySchema.safeParse({ lat: '200', lng: '31' }).success).toBe(false);
    expect(coverageQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('weekHoursSchema', () => {
  const week = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    opensMinute: 600,
    closesMinute: 1440,
    isClosed: false,
  }));

  it('accepts a full week and refuses bad days', () => {
    expect(weekHoursSchema.safeParse(week).success).toBe(true);
    expect(weekHoursSchema.safeParse(week.slice(0, 6)).success).toBe(false);
    expect(weekHoursSchema.safeParse([...week.slice(0, 6), { ...week[0]! }]).success).toBe(false);
    expect(weekHoursSchema.safeParse(week.map((d) => ({ ...d, closesMinute: 500 }))).success).toBe(
      false,
    );
  });
});

describe('zonePolygonSchema', () => {
  const square = [
    [31.4, 30.0],
    [31.5, 30.0],
    [31.5, 30.1],
    [31.4, 30.0],
  ];

  it('accepts a closed ring in Egypt', () => {
    expect(zonePolygonSchema.safeParse({ type: 'Polygon', coordinates: [square] }).success).toBe(
      true,
    );
  });

  it('refuses an open ring and a ring outside Egypt', () => {
    expect(
      zonePolygonSchema.safeParse({ type: 'Polygon', coordinates: [square.slice(0, 3)] }).success,
    ).toBe(false);
    expect(
      zonePolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [square.map(([lng, lat]) => [lng! - 31, lat! + 20])],
      }).success,
    ).toBe(false);
  });
});

describe('delivery inputs', () => {
  it('takes an area id as a coverage query', () => {
    expect(coverageQuerySchema.parse({ areaId: 'abc' })).toEqual({ areaId: 'abc' });
  });

  it('reads the pin cart attribute only as a point in Egypt', () => {
    expect(parsePinAttribute('30.0123, 31.4567')).toEqual({
      latitude: 30.0123,
      longitude: 31.4567,
    });
    expect(parsePinAttribute('51.5,-0.12')).toBeNull();
    expect(parsePinAttribute('north')).toBeNull();
    expect(parsePinAttribute(null)).toBeNull();
  });
});

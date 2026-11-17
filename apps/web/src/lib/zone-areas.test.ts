import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  boundsOf,
  clickAction,
  countByLevel,
  coverageMessage,
  coverageQuery,
  debounce,
  levelsForZoom,
  searchable,
} from './zone-areas';

const zone = { id: 'z1', darkStoreId: 's1' };
const owner = (o: Partial<Parameters<typeof clickAction>[0] & object>) => ({
  darkStoreId: 's1',
  zoneId: 'z1',
  excluded: false,
  inherited: false,
  needsReview: false,
  ...o,
});

describe('clickAction', () => {
  it('assigns an area nobody serves or one marked not served', () => {
    expect(clickAction(null, zone)).toBe('assign');
    expect(clickAction(owner({ darkStoreId: null, zoneId: null, excluded: true }), zone)).toBe(
      'assign',
    );
  });

  it('removes the zone own area on a second click, never one it serves through its district', () => {
    expect(clickAction(owner({}), zone)).toBe('unassign');
    expect(clickAction(owner({ inherited: true }), zone)).toBe('inherited');
  });

  it('asks before taking an area from another store, not from another zone of the same store', () => {
    expect(clickAction(owner({ darkStoreId: 's2', zoneId: 'z9' }), zone)).toBe('move');
    expect(clickAction(owner({ zoneId: 'z2' }), zone)).toBe('assign');
  });
});

describe('map helpers', () => {
  it('shows districts far out and neighbourhoods closer in', () => {
    expect(levelsForZoom(11)).toEqual([2]);
    expect(levelsForZoom(13)).toEqual([2, 3, 4]);
  });

  it('counts areas per level', () => {
    expect(countByLevel([{ level: 3 }, { level: 3 }, { level: 2 }])).toEqual({ 2: 1, 3: 2 });
  });

  it('finds the bounds of polygons and multipolygons', () => {
    expect(
      boundsOf({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [31.2, 30.0],
              [31.3, 30.0],
              [31.3, 30.1],
              [31.2, 30.0],
            ],
          ],
          [
            [
              [31.1, 29.9],
              [31.15, 29.9],
              [31.15, 29.95],
              [31.1, 29.9],
            ],
          ],
        ],
      }),
    ).toEqual([31.1, 29.9, 31.3, 30.1]);
  });
});

describe('search and coverage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('searches once typing pauses, with the last text only', () => {
    const run = vi.fn();
    const d = debounce(run, 300);
    d.call('ma');
    vi.advanceTimersByTime(200);
    d.call('maa');
    vi.advanceTimersByTime(299);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledExactlyOnceWith('maa');
    d.call('maad');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('searches only two letters or more', () => {
    expect(searchable(' m ')).toBeNull();
    expect(searchable('  المعادي   الجديدة ')).toBe('المعادي الجديدة');
  });

  it('asks coverage for the pin first, else the area, never a made up point', () => {
    expect(coverageQuery({ areaId: 'a1' })).toBe('areaId=a1');
    expect(coverageQuery({ areaId: 'a1', pin: { latitude: 29.96, longitude: 31.257 } })).toBe(
      'lat=29.960000&lng=31.257000',
    );
    expect(coverageQuery({})).toBeNull();
  });

  it('names every coverage answer, address_unsure included', () => {
    expect(coverageMessage({ covered: true })).toEqual({ key: 'areaOpen', ok: true });
    expect(coverageMessage({ covered: false, reason: 'address_unsure' }).key).toBe('areaUnsure');
    expect(coverageMessage({ covered: false, reason: 'store_closed' }).key).toBe('areaClosed');
    expect(coverageMessage({ covered: false, reason: 'at_capacity' }).key).toBe('areaFull');
    expect(coverageMessage({ covered: false, reason: 'outside_zones' }).key).toBe('areaOutside');
  });
});

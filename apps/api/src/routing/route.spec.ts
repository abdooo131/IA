import { routeStops } from './route';

describe('in house routing', () => {
  const cfg = { roadFactorBp: 13000, speedKmh: 25, stopBufferMin: 8 };
  it('visits the nearest stop first and accumulates ETA', () => {
    const start = { lat: 29.962, lng: 31.265 }; // Maadi hub
    const r = routeStops(start, [
      { lat: 30.0566, lng: 31.3301, item: 'nasr' },
      { lat: 29.9602, lng: 31.2569, item: 'maadi' },
      { lat: 30.0074, lng: 31.4913, item: 'new cairo' },
    ], cfg);
    expect(r.map((x) => x.item)).toEqual(['maadi', 'nasr', 'new cairo']);
    expect(r[0].etaMinutes).toBeGreaterThanOrEqual(8);
    expect(r[2].etaMinutes).toBeGreaterThan(r[1].etaMinutes);
  });
  it('puts stops without coordinates last', () => {
    const r = routeStops({ lat: 30, lng: 31 }, [{ lat: null, lng: null, item: 'x' }, { lat: 30.01, lng: 31.01, item: 'y' }], cfg);
    expect(r.map((x) => x.item)).toEqual(['y', 'x']);
  });
});

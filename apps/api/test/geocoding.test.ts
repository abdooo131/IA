import { describe, expect, it } from 'vitest';
import { OsmGeocoder } from '../src/coverage/geocoding';

/** Answers like Nominatim: only the texts in `known` are found. */
function nominatim(known: Record<string, [string, string]>) {
  const asked: string[] = [];
  const fetcher = (async (input: URL | string) => {
    const url = new URL(String(input));
    const q = url.searchParams.get('q')!;
    asked.push(q);
    expect(url.searchParams.get('countrycodes')).toBe('eg');
    const hit = known[q];
    const body = hit ? [{ lat: hit[0], lon: hit[1], display_name: q }] : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { fetcher, asked };
}

describe('OpenStreetMap geocoder (local testing)', () => {
  it('drops the street parts until the area is found', async () => {
    const { fetcher, asked } = nominatim({ 'Fifth Settlement, New Cairo': ['30.0074', '31.4913'] });
    const geocoder = new OsmGeocoder(fetcher, 0);
    const found = await geocoder.geocode('Villa 12, Fifth Settlement, New Cairo, Egypt');
    expect(found).toMatchObject({ latitude: 30.0074, longitude: 31.4913 });
    expect(asked).toEqual(['Villa 12, Fifth Settlement, New Cairo', 'Fifth Settlement, New Cairo']);
  });

  it('answers not found after three tries and fails loudly when the service is down', async () => {
    const { fetcher, asked } = nominatim({});
    expect(await new OsmGeocoder(fetcher, 0).geocode('a, b, c, d, Egypt')).toBeNull();
    expect(asked).toHaveLength(3);
    const down = (async () => new Response('busy', { status: 429 })) as typeof fetch;
    await expect(new OsmGeocoder(down, 0).geocode('Maadi, Cairo')).rejects.toMatchObject({
      response: { error: 'geocoding_failed' },
    });
  });
});

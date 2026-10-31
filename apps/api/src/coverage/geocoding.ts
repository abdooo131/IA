import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
}

/**
 * Turns an address into a map point. Kept behind this interface so the provider can be
 * swapped (or replaced by the main Shiply platform) without touching coverage.
 */
export abstract class Geocoder {
  /** Resolves to null when the address was not found. */
  abstract geocode(address: string): Promise<GeocodeResult | null>;
}

export class NotConfiguredGeocoder extends Geocoder {
  async geocode(): Promise<GeocodeResult | null> {
    throw new ServiceUnavailableException({ error: 'geocoding_not_configured' });
  }
}

interface GoogleResponse {
  status: string;
  results: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[];
}

@Injectable()
export class GoogleGeocoder extends Geocoder {
  constructor(private readonly apiKey: string) {
    super();
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('components', 'country:EG');
    url.searchParams.set('key', this.apiKey);

    let body: GoogleResponse;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      body = (await res.json()) as GoogleResponse;
    } catch {
      throw new BadGatewayException({ error: 'geocoding_failed' });
    }
    if (body.status === 'ZERO_RESULTS') return null;
    const first = body.results[0];
    if (body.status !== 'OK' || !first)
      throw new BadGatewayException({ error: 'geocoding_failed' });
    return {
      latitude: first.geometry.location.lat,
      longitude: first.geometry.location.lng,
      formattedAddress: first.formatted_address,
    };
  }
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
}

/**
 * OpenStreetMap's free Nominatim service, for local testing without a Google key
 * (GEOCODER=osm). Its usage policy allows about one request a second with a named client, so
 * it is never used in production. Shopify addresses are often too precise for it, so when the
 * full text is not found the leading parts (street, building) are dropped and it tries again.
 */
export class OsmGeocoder extends Geocoder {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly pauseMs = 1100,
  ) {
    super();
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    const parts = address
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p && p.toLowerCase() !== 'egypt');
    for (let drop = 0; drop < Math.min(parts.length, 3); drop++) {
      if (drop > 0) await new Promise((r) => setTimeout(r, this.pauseMs));
      const found = await this.search(parts.slice(drop).join(', '));
      if (found) return found;
    }
    return null;
  }

  private async search(text: string): Promise<GeocodeResult | null> {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', text);
    url.searchParams.set('countrycodes', 'eg');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    let places: NominatimPlace[];
    try {
      const res = await this.fetcher(url, {
        headers: { 'user-agent': 'ShiplyNow pilot (local testing)' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(String(res.status));
      places = (await res.json()) as NominatimPlace[];
    } catch {
      throw new BadGatewayException({ error: 'geocoding_failed' });
    }
    const first = places[0];
    if (!first) return null;
    return {
      latitude: Number(first.lat),
      longitude: Number(first.lon),
      formattedAddress: first.display_name,
    };
  }
}

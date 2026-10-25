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

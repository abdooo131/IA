// Google Maps as the last automatic step: behind this interface, so tests use a fake and the
// system runs without a key.

export interface GeoAnswer {
  lat: number;
  lng: number;
  /** area names from the answer, smallest first: street, neighbourhood, district, governorate */
  names: string[];
  /** Google placed the exact building or street number, and matched the whole address */
  precise: boolean;
}

export interface Geocoder {
  lookup(text: string): Promise<GeoAnswer | null>;
}

export const GEOCODER = Symbol('GEOCODER');

const AREA_TYPES = ['route', 'neighborhood', 'sublocality', 'locality', 'administrative_area_level_3', 'administrative_area_level_2', 'administrative_area_level_1'];

interface GoogleJson {
  status: string;
  results: {
    partial_match?: boolean;
    geometry: { location: { lat: number; lng: number }; location_type: string };
    address_components: { long_name: string; types: string[] }[];
  }[];
}

/** Reads the Geocoding API answer (https://developers.google.com/maps/documentation/geocoding). */
export function answerFromGoogle(json: GoogleJson): GeoAnswer | null {
  if (json.status === 'ZERO_RESULTS') return null;
  // A refused key, a full quota or a Google error is not "nothing found": it is retried later.
  if (json.status !== 'OK') throw new Error(`Google Maps status ${json.status}`);
  const top = json.results[0];
  if (!top) return null;
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    names: top.address_components.filter((c) => c.types.some((t) => AREA_TYPES.includes(t))).map((c) => c.long_name),
    precise: !top.partial_match && ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(top.geometry.location_type),
  };
}

export class GoogleGeocoder implements Geocoder {
  constructor(private readonly key: string) {}

  async lookup(text: string): Promise<GeoAnswer | null> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', text);
    url.searchParams.set('region', 'eg');
    url.searchParams.set('language', 'ar');
    url.searchParams.set('key', this.key);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Google Maps answered ${res.status}`);
    return answerFromGoogle((await res.json()) as GoogleJson);
  }
}

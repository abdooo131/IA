export interface LatLng {
  lat: number;
  lng: number;
}

/** Great circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Deterministic small offset (up to ~600 m) so mock geocoded points do not stack exactly. */
export function jitter(seed: string, point: LatLng, maxDeg = 0.005): LatLng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 10000) / 10000 - 0.5;
  const b = (((h >>> 16) ^ h) >>> 0) % 10000 / 10000 - 0.5;
  return { lat: point.lat + a * 2 * maxDeg, lng: point.lng + b * 2 * maxDeg };
}

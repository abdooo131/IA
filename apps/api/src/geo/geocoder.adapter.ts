import { Injectable } from '@nestjs/common';
import { Tx } from '../prisma/prisma.service';
import { jitter } from './geo';

export interface GeocodeRequest {
  governorateCode: string;
  area: string;
  addressLine: string;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** 'area' = matched a known area, 'governorate' = fell back to the governorate centroid */
  precision: 'area' | 'governorate';
  areaId: string | null;
  source: string;
}

/** Adapter boundary: the Google Maps implementation will be added when credentials are provided. */
export interface GeocoderAdapter {
  geocode(tx: Tx, req: GeocodeRequest): Promise<GeocodeResult | null>;
}

export const GEOCODER = Symbol('GEOCODER');

/** Mock geocoder: matches the area / address text against the seeded areas table, else the governorate centroid. */
@Injectable()
export class MockGeocoder implements GeocoderAdapter {
  async geocode(tx: Tx, req: GeocodeRequest): Promise<GeocodeResult | null> {
    const gov = await tx.governorate.findUnique({ where: { code: req.governorateCode } });
    if (!gov) return null;
    const areas = await tx.area.findMany({ where: { governorateCode: gov.code } });
    const haystack = `${req.area} ${req.addressLine}`.toLowerCase();
    const seed = `${req.governorateCode}|${req.area}|${req.addressLine}`;
    // Longest keyword wins so "new cairo" beats "cairo".
    let best: { id: string; lat: number; lng: number; len: number } | null = null;
    for (const a of areas) {
      for (const k of [a.nameEn, a.nameAr, ...a.keywords]) {
        const kw = k.toLowerCase().trim();
        if (kw && haystack.includes(kw) && (!best || kw.length > best.len)) {
          best = { id: a.id, lat: a.lat, lng: a.lng, len: kw.length };
        }
      }
    }
    if (best) return { ...jitter(seed, best), precision: 'area', areaId: best.id, source: 'mock' };
    return { ...jitter(seed, { lat: gov.lat, lng: gov.lng }, 0.02), precision: 'governorate', areaId: null, source: 'mock' };
  }
}

'use client';
import { useLoad } from '@/parcels/lib/hooks';

export interface Area {
  id: string;
  nameEn: string;
  nameAr: string;
}
export interface Governorate {
  code: string;
  nameEn: string;
  nameAr: string;
  served: boolean;
  areas: Area[];
}

/** Governorates and areas for address forms (public list). */
export function useLocations() {
  return useLoad<Governorate[]>('/reference/locations');
}

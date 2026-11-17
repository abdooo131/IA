'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface Pin {
  latitude: number;
  longitude: number;
}

const CAIRO: L.LatLngTuple = [30.03, 31.33];

const pinIcon = L.divIcon({
  className: '',
  html: '<span style="display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;background:#0047BB;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:rotate(-45deg)"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

/**
 * A small OpenStreetMap where the customer's door is pinned: tap the map to drop the pin,
 * drag it to correct it. Only a real point the user chose is ever sent.
 */
export default function PinMap({
  pin,
  onPin,
  label,
  frame,
}: {
  pin: Pin | null;
  /** [minLng, minLat, maxLng, maxLat] of the chosen area, to start the map there */
  frame?: [number, number, number, number] | null;
  onPin(pin: Pin): void;
  /** Accessible name of the map */
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = L.map(container.current, { zoomControl: true }).setView(CAIRO, 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) =>
      onPinRef.current({
        latitude: Number(e.latlng.lat.toFixed(6)),
        longitude: Number(e.latlng.lng.toFixed(6)),
      }),
    );
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  // Start where the chosen neighbourhood is, unless a pin is already there.
  const [w, s, e, n] = frame ?? [];
  useEffect(() => {
    const m = map.current;
    if (!m || w === undefined || marker.current) return;
    m.fitBounds(
      [
        [s!, w],
        [n!, e!],
      ],
      { padding: [16, 16], maxZoom: 16 },
    );
  }, [w, s, e, n]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const at: L.LatLngTuple = [pin.latitude, pin.longitude];
    if (!marker.current) {
      marker.current = L.marker(at, { icon: pinIcon, draggable: true, keyboard: true }).addTo(m);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng();
        onPinRef.current({
          latitude: Number(p.lat.toFixed(6)),
          longitude: Number(p.lng.toFixed(6)),
        });
      });
      if (m.getZoom() < 15) m.setView(at, 15);
    } else marker.current.setLatLng(at);
  }, [pin]);

  // Leaflet assumes left to right; keep the map LTR inside Arabic pages.
  return (
    <div
      dir="ltr"
      ref={container}
      role="application"
      aria-label={label}
      className="h-72 w-full rounded-lg border border-line"
    />
  );
}
